import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db/client.js';
import { users, type User } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { tr } from '../lib/i18n.js';
import type { OnboardingIdentity } from '../services/identity.js';

export interface SessionClaims {
  typ: 'session';
  uid: number;
}
export interface OnboardingClaims {
  typ: 'onboarding';
  tg: OnboardingIdentity;
}
type Claims = SessionClaims | OnboardingClaims;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Claims;
    user: Claims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    account: User | null;
    onboarding: OnboardingIdentity | null;
  }
}

export const signSession = (app: FastifyInstance, user: Pick<User, 'id'>) =>
  app.jwt.sign({ typ: 'session', uid: user.id }, { expiresIn: '12h' });

export const signOnboarding = (app: FastifyInstance, tg: OnboardingIdentity) =>
  app.jwt.sign({ typ: 'onboarding', tg }, { expiresIn: '30m' });

function bearer(req: FastifyRequest) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function verify(app: FastifyInstance, req: FastifyRequest): Claims {
  const token = bearer(req);
  if (!token) throw unauthorized(tr('err.please_sign_in'));
  try {
    return app.jwt.verify<Claims>(token);
  } catch {
    throw unauthorized(tr('err.session_expired'));
  }
}

export function makeGuards(app: FastifyInstance) {
  /** Any signed-in account. Role is re-read from the database on every request. */
  const customer = async (req: FastifyRequest) => {
    const claims = verify(app, req);
    if (claims.typ !== 'session') throw unauthorized(tr('err.finish_onboarding'));
    const [u] = await db.select().from(users).where(eq(users.id, claims.uid));
    if (!u || u.isBlocked || u.deletedAt) throw unauthorized(tr('err.account_unavailable'));
    req.account = u;
  };
  const staff = async (req: FastifyRequest) => {
    await customer(req);
    if (req.account!.role !== 'staff' && req.account!.role !== 'admin') throw forbidden(tr('err.staff_only'));
  };
  const admin = async (req: FastifyRequest) => {
    await customer(req);
    if (req.account!.role !== 'admin') throw forbidden(tr('err.admin_only'));
  };
  const onboarding = async (req: FastifyRequest) => {
    const claims = verify(app, req);
    if (claims.typ !== 'onboarding') throw unauthorized(tr('err.onboarding_expired'));
    req.onboarding = claims.tg;
  };
  return { customer, staff, admin, onboarding };
}

export type Guards = ReturnType<typeof makeGuards>;
