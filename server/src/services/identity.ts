import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { coupons, customerRewards, staffLoginTokens, users, welcomeGrants, type User } from '../db/schema.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { parseLang, tr } from '../lib/i18n.js';
import { normalizePhone, type NormalizedPhone } from '../lib/phone.js';
import { TelegramAuthError, validateContactResponse, type TelegramUser } from '../lib/telegram-auth.js';
import { applyPoints, rewardExpiry, serializeCoupon, syncMilestones } from './loyalty.js';
import { getLevels, getSettings, levelFor } from './settings.js';

/** Verified Telegram identity of someone who has not created a customer account yet. */
export interface OnboardingIdentity {
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  startParam: string | null;
}

export type IdentityResult = { status: 'existing'; user: User } | { status: 'new'; identity: OnboardingIdentity };

const isAdminTelegramId = (id: number) => config.ADMIN_TELEGRAM_IDS.includes(id);

/**
 * Called after initData has been verified. Returning customers get their account (profile fields
 * synced from Telegram); new customers get an onboarding identity — no row is written until they
 * accept the privacy notice. Telegram IDs listed in ADMIN_TELEGRAM_IDS get an admin account directly.
 */
export async function resolveTelegramIdentity(tg: TelegramUser, startParam: string | null): Promise<IdentityResult> {
  const now = new Date();
  const [existing] = await db.select().from(users).where(eq(users.telegramId, tg.id));
  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        username: tg.username ?? null,
        photoUrl: tg.photo_url ?? existing.photoUrl,
        lastSeenAt: now,
        role: isAdminTelegramId(tg.id) ? 'admin' : existing.role,
      })
      .where(eq(users.id, existing.id))
      .returning();
    return { status: 'existing', user: updated };
  }

  if (isAdminTelegramId(tg.id)) {
    await db
      .insert(users)
      .values({
        telegramId: tg.id,
        firstName: tg.first_name.slice(0, 64),
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
        photoUrl: tg.photo_url ?? null,
        role: 'admin',
        privacyAcceptedAt: now,
        signupSource: 'admin',
        lastSeenAt: now,
      })
      .onConflictDoNothing({ target: users.telegramId });
    const [admin] = await db.select().from(users).where(eq(users.telegramId, tg.id));
    return { status: 'existing', user: admin };
  }

  return {
    status: 'new',
    identity: {
      telegramId: tg.id,
      firstName: tg.first_name,
      lastName: tg.last_name ?? null,
      username: tg.username ?? null,
      photoUrl: tg.photo_url ?? null,
      languageCode: tg.language_code ?? null,
      startParam,
    },
  };
}

export interface CompleteOnboardingInput {
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  contactResponse?: string | null;
  acceptPrivacy: boolean;
  /** App language chosen on the first screen (km | en). */
  languageCode?: string | null;
}

export function resolvePhoneInput(
  telegramId: number,
  input: { phone?: string | null; contactResponse?: string | null },
): { phone: NormalizedPhone | null; verified: boolean } {
  if (input.contactResponse) {
    try {
      const contact = validateContactResponse(input.contactResponse, config.TELEGRAM_BOT_TOKEN, telegramId);
      const phone = normalizePhone(contact.phoneNumber, { international: true });
      if (!phone) throw new TelegramAuthError('Unrecognised phone format');
      return { phone, verified: true };
    } catch (err) {
      throw badRequest(
        'contact_unverified',
        tr('err.contact_unverified'),
        err instanceof Error ? err.message : undefined,
      );
    }
  }
  if (input.phone && input.phone.trim()) {
    const phone = normalizePhone(input.phone);
    if (!phone) throw badRequest('invalid_phone', tr('err.invalid_phone'));
    return { phone, verified: false };
  }
  return { phone: null, verified: false };
}

/**
 * Creates the customer account + loyalty membership. Idempotent: a second call (double tap, second
 * device) returns the existing account and never grants welcome rewards twice. Welcome rewards are
 * also limited to one per phone number.
 */
export async function completeOnboarding(identity: OnboardingIdentity, input: CompleteOnboardingInput) {
  if (input.acceptPrivacy !== true) throw badRequest('privacy_required', tr('err.privacy_required'));
  const firstName = input.firstName.trim();
  if (!firstName) throw badRequest('name_required', tr('err.name_required'));
  const { phone, verified } = resolvePhoneInput(identity.telegramId, input);

  return db.transaction(async (tx) => {
    const now = new Date();
    const inserted = await tx
      .insert(users)
      .values({
        telegramId: identity.telegramId,
        firstName: firstName.slice(0, 64),
        lastName: input.lastName?.trim().slice(0, 64) || null,
        username: identity.username,
        photoUrl: identity.photoUrl,
        languageCode: parseLang(input.languageCode) ?? null,
        phone: phone?.display ?? null,
        phoneVerified: verified,
        privacyAcceptedAt: now,
        signupSource: identity.startParam ?? 'direct',
        lastSeenAt: now,
      })
      .onConflictDoNothing({ target: users.telegramId })
      .returning();

    if (!inserted.length) {
      const [user] = await tx.select().from(users).where(eq(users.telegramId, identity.telegramId));
      return { user, created: false, welcome: null };
    }

    const user = inserted[0];
    const settings = await getSettings(tx);
    let balance = 0;
    let pointsAwarded = 0;
    let welcomeCoupon: ReturnType<typeof serializeCoupon> | null = null;

    // One welcome grant per account and per phone number (two unique indexes; ON CONFLICT covers both).
    const grant = await tx
      .insert(welcomeGrants)
      .values({ userId: user.id, phoneKey: phone?.key ?? null, pointsGranted: settings.signupBonusPoints })
      .onConflictDoNothing()
      .returning({ id: welcomeGrants.id });

    if (grant.length) {
      if (settings.signupBonusPoints > 0) {
        const r = await applyPoints(tx, {
          userId: user.id,
          delta: settings.signupBonusPoints,
          type: 'signup_bonus',
          idempotencyKey: `signup:${user.id}`,
          note: 'Welcome bonus',
        });
        balance = r.balance;
        pointsAwarded = r.applied ? settings.signupBonusPoints : 0;
      }
      if (settings.welcomeCouponId) {
        const [coupon] = await tx
          .select()
          .from(coupons)
          .where(and(eq(coupons.id, settings.welcomeCouponId), eq(coupons.active, true)));
        if (coupon) {
          const added = await tx
            .insert(customerRewards)
            .values({ userId: user.id, couponId: coupon.id, source: 'welcome', expiresAt: rewardExpiry(settings, now) })
            .onConflictDoNothing()
            .returning({ id: customerRewards.id });
          if (added.length) welcomeCoupon = serializeCoupon(coupon, settings.currency);
        }
      }
      await syncMilestones(tx, user, balance, { settings });
    }

    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id));
    const level = levelFor(await getLevels(tx), fresh.pointsBalance).current;
    return {
      user: fresh,
      created: true,
      welcome: {
        pointsAwarded,
        welcomeCoupon,
        skippedReason: grant.length ? null : ('phone_already_used' as const),
        level: { name: level.name, emoji: level.emoji },
      },
    };
  });
}

export function publicUser(u: User) {
  return {
    id: u.id,
    telegramId: u.telegramId,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    photoUrl: u.photoUrl,
    phone: u.phone,
    phoneVerified: u.phoneVerified,
    role: u.role,
    pointsBalance: u.pointsBalance,
    languageCode: u.languageCode,
    createdAt: u.createdAt,
  };
}

// ---------- Staff browser login (one-time link sent by the bot) ----------

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createStaffLoginLink(user: User) {
  if (user.role !== 'staff' && user.role !== 'admin') throw forbidden();
  const token = randomBytes(32).toString('base64url');
  await db.insert(staffLoginTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return new URL(`/admin/login?token=${token}`, config.PUBLIC_URL).toString();
}

export async function consumeStaffLoginToken(token: string) {
  const [row] = await db
    .update(staffLoginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(staffLoginTokens.tokenHash, hashToken(token)), isNull(staffLoginTokens.usedAt), gt(staffLoginTokens.expiresAt, new Date())),
    )
    .returning({ userId: staffLoginTokens.userId });
  if (!row) throw unauthorized(tr('err.staff_link_invalid'));
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user || (user.role !== 'staff' && user.role !== 'admin')) throw forbidden();
  return user;
}
