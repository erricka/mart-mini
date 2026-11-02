# Sunny Market — Telegram Mini App: Product & Technical Plan

## 1. Product summary

A Telegram Mini App for a physical supermarket. Customers find it by scanning a QR code in the
store or on a receipt, which opens the shop's bot and Mini App right inside Telegram. They get a
short onboarding, then can shop with delivery or pickup and earn loyalty points that unlock
milestone rewards. Shop staff use a separate dashboard (same codebase, `/admin`) to handle orders,
manage the catalog and inventory, set up loyalty, and see simple sales numbers.

**Design principle:** shopping should feel like a small game (progress bars, unlocks, confetti),
but every step stays obvious: big buttons, five tabs, no hidden gestures.

## 2. Assumptions (v1)

| Topic | Assumption |
| --- | --- |
| Currency | USD, stored as integer cents. Currency code is a shop setting. |
| Payments | **Cash on delivery / at pickup**, or **pay now by QR**. QR orders wait as *Awaiting payment* (stock reserved) and reach the shop only once paid. QR generation is a provider interface: a clearly labelled **simulated** provider for development and an **ABA PayWay placeholder** for the shop's own ABA API. |
| Points model | Points are **cumulative (not spent)**. Crossing a milestone threshold unlocks a reward the customer redeems at checkout. A spendable "points shop" is a phase-2 idea. |
| Earn rule | `points = floor(merchandise total after discount ÷ $1 × points-per-dollar × level multiplier)`. Delivery fees earn no points. The amount is fixed when the order is placed (shown to the customer) and **credited only when the order is Delivered/Collected**. |
| Discounts | At most **one coupon or reward per order**. |
| Free delivery | Based on merchandise subtotal **before** discounts. |
| Refunds | Full refunds only. A refund of a completed order reverses exactly the points it earned (once). Stock is not auto-restocked on refund. Staff adjust inventory if goods come back. |
| Cancellation | Customers can cancel while the order is still *Placed*. Staff can cancel any order that isn't complete. Cancelling restores stock and returns the coupon/reward to the customer. |
| Phone | Never assumed from Telegram. Customers can share it through Telegram's `requestContact` flow (verified server-side) or type it in (marked unverified). It's optional at signup and required at checkout. |
| Welcome gift | One per Telegram account **and** one per phone number (both enforced by unique DB indexes). |
| Product photos | Seed products use colourful emoji tiles so nothing depends on external images. Staff can upload real photos (stored on local disk in v1; use S3/R2 in production). |
| Tracking | Status updates entered by staff. No GPS. |
| Staff access | Telegram IDs in `ADMIN_TELEGRAM_IDS` become admins. Admins can promote customers to staff. Staff open the dashboard inside Telegram (bot `/dashboard` button) or in a desktop browser through a one-time login link the bot sends. |

## 3. Journeys

### Customer — first visit (QR)
1. Scans the QR code (store poster or receipt) → `t.me/<bot>/<app>?startapp=store` opens the Mini App in Telegram.
2. A branded splash screen shows while the backend **validates Telegram `initData`** (HMAC). The backend reports *new* or *returning*.
3. *New:* welcome screen → **Get Started**.
4. Profile step: name pre-filled from Telegram (editable), Telegram photo shown if available, **"Share my Telegram number"** (Telegram contact sheet) or type it in, or skip.
5. Short privacy notice with an "I agree" checkbox → **Create my membership**. Only now is the customer row created. The signup bonus and welcome coupon are granted once, in one transaction.
6. Celebration screen: points balance, first milestone ("You're 50 points from Free Delivery"), welcome coupon → **Start Shopping**.
7. Browse categories, search, add to cart → checkout: **Delivery or Pickup?** (address only for delivery), contact, reward/coupon, **QR or cash**, totals → Place order.
8. **Cash:** the order goes to the shop immediately. **QR:** a payment screen (QR, amount, reference, countdown, "Open in ABA Mobile"). Once payment is confirmed, the order goes to the shop. If it isn't paid in time, it's auto-cancelled and the stock released.
9. Confirmation and tracking timeline. Telegram bot messages on each important status change.
10. When staff mark the order *Delivered*/*Collected*, points are credited, milestones unlock, and a 🎉 notification is sent.

### Customer — returning
Opens from QR, the bot menu or a chat link → splash → validated → straight to **Home** (no onboarding).
They can edit their name, phone and addresses any time in Profile.

### Seller / staff
1. Opens the dashboard (Telegram `/dashboard` button, or a browser login link from the bot).
2. **Orders:** a new order triggers a sound, a toast and a badge, plus a bot message to staff. They open it to see items, customer, address/pickup, payment status and notes. Then they **Accept** → *Preparing* → *Out for delivery*/*Ready for pickup* → *Delivered*/*Collected*. Payment is marked separately (Unpaid → Paid → Refunded).
3. **Catalog:** products, categories, prices, promo (compare-at) prices, photos, stock adjustments.
4. **Loyalty:** earn rate, signup bonus, welcome coupon, levels, milestone rewards, coupons, gifts.
5. **Customers:** search, points history, orders, manual point adjustments (audited).
6. **Insights:** revenue, orders, average basket, top products, sign-ups by QR source.
7. **QR codes:** printable posters and receipt QR codes, each with a source tag for attribution.

## 4. Architecture

```
 Telegram client ──(Mini App WebView)──► React SPA  (/ customer, /admin dashboard)
       │                                     │  HTTPS JSON, Bearer JWT
       │ bot messages                        ▼
       └──────────── Telegram Bot API ◄── Fastify API (Node 22, TypeScript)
                                             │  Drizzle ORM (SQL, transactions, row locks)
                                             ▼
                                        PostgreSQL 16
```

**Stack and why**
- **React + Vite + TypeScript + Tailwind** for both the Mini App and the dashboard. It's one SPA,
  code-split so customers never download dashboard code. Telegram's official `telegram-web-app.js`
  handles theme, haptics, BackButton and `requestContact`. TanStack Query gives consistent loading,
  error and caching states.
- **Fastify** (fast, schema-friendly, small) with **zod** validation and JWT sessions.
- **PostgreSQL**: real transactions, `SELECT … FOR UPDATE`, unique and partial indexes and CHECK
  constraints. These enforce stock, idempotency and once-only rewards *in the database*, not just in
  code. **Drizzle ORM** keeps the SQL visible and typed, with no native binaries.
- **Telegram Bot API over plain `fetch`** (webhook in production, long-polling in dev).
  Notifications use an **outbox table**, so a Telegram outage never loses or blocks an order update.
- **One deployable**: the API serves the built SPA. Deploy to Render/Railway/Fly with managed
  Postgres (Neon, Supabase, RDS…).

**Security**
- `initData` is validated server-side (HMAC-SHA256 with `WebAppData` key, constant-time compare,
  max age). Shared contacts from `requestContact` are validated the same way, and the contact's
  `user_id` must match.
- Short-lived JWTs: an `onboarding` token (holds only the verified Telegram identity) and a
  `session` token (user id). The role is re-read from the DB on every request.
- Role guards: `customer`, `staff`, `admin`. Rate limits on auth and order endpoints. All prices,
  discounts, fees and points are computed on the server. Client prices are ignored.

## 5. Database structure (main tables)

| Table | Purpose / key constraints |
| --- | --- |
| `users` | Telegram id (**unique**), display name, photo, phone (+verified flag), role, `points_balance`, `privacy_accepted_at`, `signup_source` (QR tag) |
| `addresses` | Customer delivery addresses, one default |
| `categories`, `products` | Catalog. `products.stock` has **CHECK (stock >= 0)**. `compare_at_cents` for promotions |
| `inventory_movements` | Audit of every stock change (order, cancel, restock, adjustment) |
| `shop_settings` | Single row: fees, free-delivery threshold, pickup address, earn rate, signup bonus, welcome coupon, reward expiry |
| `levels` | Bronze/Silver/Gold… with thresholds and points multiplier |
| `coupons` | Discount definitions: percent / fixed / free delivery / free product (gift), limits, dates, public code |
| `rewards` | Milestones: points required → coupon |
| `customer_rewards` | A customer's wallet: unlocked milestone rewards and welcome coupons. **unique(user, reward)**, **unique(user) where source = welcome** |
| `welcome_grants` | **unique(user)** and **unique(phone)** to stop repeated welcome rewards |
| `orders` | Fulfilment type, **fulfilment status** and **payment status** as separate columns, totals, address and contact snapshot, `points_estimate`, `points_awarded`. **unique(user, idempotency_key)** |
| `order_items` | Name, price and quantity snapshot, gift flag |
| `order_events` | Timeline (status and payment changes, who did it, notes) |
| `payments` | Provider (`cash`, `simulated`, `aba_payway`), amount, status, QR payload, deep link, reference, expiry, unguessable checkout token |
| `coupon_redemptions` | One per order. Released on cancel. Drives usage limits |
| `points_transactions` | Append-only ledger. **unique(idempotency_key)**, e.g. `order:42:earn`, `order:42:reversal`, `signup:7` |
| `notifications` | Outbox of bot messages: pending / sent / failed / **simulated** |
| `staff_login_tokens` | One-time hashed browser login links for the dashboard |

## 6. Correctness rules

- **Duplicate orders:** each checkout carries a client-generated idempotency key. The server locks
  the customer row, re-checks the key and relies on the unique index. A repeat returns the
  original order.
- **Stock:** inside the order transaction, product rows are locked in id order, stock is checked,
  and `UPDATE … SET stock = stock - q WHERE stock >= q` runs. The CHECK constraint is the last line
  of defence. Cancel restores stock exactly once (guarded by the status transition).
- **Status changes:** an allowed-transition table per fulfilment type, applied with the order row
  locked. Terminal states can't change.
- **Points:** credited only on transition to Delivered/Collected, as a ledger row with a unique key.
  Refunds write one reversal row with a unique key. Completing a refunded order earns nothing.
- **QR payments:** QR orders start as `awaiting_payment` and are invisible to the new-order queue and alerts. `confirmQrPayment` is idempotent: it marks the order paid and moves it to `placed` exactly once. A worker cancels orders whose payment window has passed. The provider QR is requested outside the order transaction, so a slow bank API never holds stock locks.
- **Rewards:** redemption uses `UPDATE … WHERE status = 'available'` inside the order transaction.
  Cancelling an order returns the reward. Coupon global limits use an atomic conditional increment.

## 7. Phased plan

| Phase | Scope |
| --- | --- |
| **1 — MVP (built now)** | QR entry and onboarding, Telegram auth, profile and addresses, catalog/search/cart, checkout (delivery/pickup, COD), seller order management with alerts, customer tracking, bot notifications (real or simulated), points, levels, milestone rewards, welcome coupon, coupons, dashboard catalog/loyalty/customers/insights, QR generator |
| 2 — Payments and polish | Connect ABA PayWay (KHQR) behind the existing provider interface, partial refunds, product variants, image CDN, scheduled delivery slots, i18n |
| 3 — Engagement | Features from the list below, push campaigns via bot, referral codes |
| 4 — Operations | Live courier GPS, multi-store, POS/receipt integration (scan receipt QR to earn points for in-store purchases), staff permissions per area |

## 8. Suggested extra game features (not in v1)

- **Streaks:** order N weeks in a row for bonus points.
- **Badges:** "Fresh Fan" (fresh produce 5×), "Early Bird" (orders before 9am), "Explorer" (all categories).
- **Spin-the-wheel / scratch card** after each completed order (server-decided outcome).
- **Weekly challenges:** "Buy 3 fruits this week → +30 pts".
- **Points shop:** spend points on items as well as unlocking milestones.
- **Referral:** both friends get points after the friend's first completed order.
- **In-store points:** scan the receipt QR to claim points for offline purchases.
- **Seasonal events:** double points weekends, holiday sticker collections.
