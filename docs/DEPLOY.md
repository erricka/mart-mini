# Going live: production setup and opening the app in Telegram

About 30–45 minutes, no server administration needed. You'll do four things:

1. Create the Telegram bot.
2. Deploy the app to Render (hosting plus database, Singapore region).
3. Connect the bot to the app.
4. Set up the shop in the dashboard and print the QR codes.

You need:

- a Telegram account (two accounts or a friend's phone help for testing)
- this code on GitHub
- a [Render](https://render.com) account (paid "Starter" plans, about US$15/month total; check Render's pricing page)

---

## 1. Create the Telegram bot

1. In Telegram, open **[@BotFather](https://t.me/BotFather)** and send `/newbot`.
2. Choose a display name (e.g. *Sunny Market*) and a username ending in `bot` (e.g. `sunnymarket_kh_bot`).
3. BotFather replies with a **token** like `7123456789:AAH...`. **Keep it secret.** Anyone with it controls your bot.
4. Find **your own Telegram user ID**: open **[@userinfobot](https://t.me/userinfobot)** and press Start. Note the number after `Id:`. This becomes the shop admin.

Optional branding in BotFather: `/setuserpic` (logo), `/setdescription` (shown before Start), `/setabouttext`.

## 2. Deploy to Render

1. Render Dashboard → **New → Blueprint** → connect GitHub → choose the repository.
   Render reads `render.yaml` and proposes a **web service** (`sunny-market`) and a **PostgreSQL database**, both in Singapore.
2. Fill in the values it asks for:

   | Key | Value |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | the token from BotFather |
   | `TELEGRAM_BOT_USERNAME` | the bot username **without** `@` |
   | `ADMIN_TELEGRAM_IDS` | your user ID from @userinfobot (comma-separate several admins) |

   Everything else is set automatically: the session secret, webhook secret, database connection, migrations, the public URL, and **starter shop data on first boot**.
3. Click **Apply**. The first build takes a few minutes.
4. When it's live, copy the service URL, e.g. `https://sunny-market.onrender.com`. Opening it in a normal browser shows *"Open in Telegram"*. That's expected: the app only signs people in through Telegram.
5. Check the service **Logs**. You should see:

   ```
   🌱 First boot: creating starter shop setup …
   Telegram webhook registered
   Bot menu button → https://sunny-market.onrender.com
   🛒 API ready … notifications via Telegram, simulated QR payments off, dev login off
   ```

## 3. Connect the bot to the Mini App

The server has already set the bot's **menu button** (🛒 Shop) and commands. One step in BotFather enables QR-code links:

1. BotFather → `/mybots` → your bot → **Bot Settings → Configure Mini App → Enable Mini App**.
2. Send your Render URL (`https://sunny-market.onrender.com`).

You can now open **`https://t.me/<your_bot>?startapp=store`**, which is what the QR codes point to.

> Optional: `/newapp` in BotFather creates a named Mini App with a short name (e.g. `shop`). Set `TELEGRAM_MINIAPP_SHORT_NAME=shop` in Render and QR links become `https://t.me/<your_bot>/shop?startapp=store`.

## 4. Open it in Telegram

**As the admin (your account):**

1. Open your bot → **Start** → tap the **🛒 Shop** button next to the message box.
2. Because your ID is in `ADMIN_TELEGRAM_IDS`, you go straight in, with no onboarding.
3. Send **`/dashboard`** to the bot. You get two buttons:
   - **📋 Open dashboard here:** the seller dashboard inside Telegram (works on Telegram Desktop too).
   - **🖥️ Open in browser:** a one-time login link for a computer browser, valid for 10 minutes.

**As a new customer (use a second Telegram account or a friend's phone):** scan a QR code or open `https://t.me/<your_bot>?startapp=store`. You'll see:

1. welcome screen
2. name and phone
3. privacy notice
4. celebration with welcome points
5. Start Shopping

## 5. Set up the shop (dashboard)

1. **Settings:** shop name, tagline, currency (USD or KHR), support phone, delivery fee, free-delivery threshold, minimum order, pickup address and hours. Payments are **cash only** for now (see *Payments* below).
2. **Catalog → Products → + New product:** name, aisle, price, optional "was" price for promotions, starting stock, and a photo (📷 Upload). The 9 aisles already exist. Rename, hide or add more under *Categories*.
3. **Loyalty:** points per dollar, welcome bonus, welcome coupon, levels and milestone rewards (pre-filled: Free delivery at 100 points, $3 off at 250, $5 off at 500, $10 off at 1000). You can add free-product gifts once products exist.
4. **Staff:** each staff member opens the shop once in Telegram. Then go to **Customers → their name → Account role → Staff**, and they can use `/dashboard`.
5. **QR codes:** download the PNGs or print the posters. Use **In-store poster** at the entrance and checkouts and **Printed receipts** in the receipt footer. Insights shows which code brings sign-ups.

**Before printing, test end to end:** place an order with the second account, accept it in the dashboard, mark it *Delivered*/*Collected*, and check that the customer receives Telegram messages and points.

## Payments

- **Cash on delivery / at pickup** works now.
- **QR (ABA):** simulated payments are automatically **disabled in production**, so the QR option stays hidden until ABA is connected. When you have your ABA PayWay credentials, implement `server/src/services/providers/aba-payway.ts` (instructions are in the file). Then add these to Render:
  - `ABA_PAYWAY_MERCHANT_ID`
  - `ABA_PAYWAY_API_KEY`
  - `ABA_PAYWAY_BASE_URL`

  Push the change and choose **Settings → Payments → QR payment → ABA PayWay**.
- For a private demo only, `ALLOW_SIMULATED_PAYMENTS=true` turns the clearly-labelled fake QR back on. **Never leave it on for real customers.**

## Day-to-day

- **Updates:** push to GitHub and Render redeploys automatically. Database migrations run on boot.
- **Photos:** stored on the attached Render disk (`server/uploads`), so they survive deploys.
- **Backups:** check the backup options of your Render Postgres plan, and test a restore once.
- **Custom domain (optional):** Render → service → Settings → Custom Domains. Then set `PUBLIC_URL=https://shop.yourdomain.com` and update the Mini App URL in BotFather.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"We couldn't verify your Telegram session"* | `TELEGRAM_BOT_TOKEN` doesn't match the bot you opened (or you revoked the token). Update it in Render and redeploy. |
| Bot doesn't answer `/start` or `/dashboard` | Check the logs for *Telegram webhook registered*. Open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` in a browser: `url` should be your Render URL and `last_error_message` empty. |
| No 🛒 Shop button | Close and reopen the chat. It's set on boot when the URL is https. You can also set it in BotFather → `/setmenubutton`. |
| Customers don't get order messages | They must allow messages. The app asks during onboarding and after an order (“Get order updates in Telegram”). Customers who pressed Start in the bot chat always receive them. |
| `/dashboard` says *staff only* | Add your user ID to `ADMIN_TELEGRAM_IDS`, or have an admin set your role to Staff. |
| First load is slow | You're on a free instance that sleeps. Use the paid Starter plan in production. |

## Alternative: your own server (VPS)

On any Linux VPS with Docker (e.g. a Singapore region):

```bash
git clone <your repo> && cd <repo>
cp .env.example .env
# edit .env: NODE_ENV=production, SESSION_SECRET, PUBLIC_URL=https://your-domain,
# TELEGRAM_* values, TELEGRAM_BOT_MODE=webhook, TELEGRAM_WEBHOOK_SECRET, ADMIN_TELEGRAM_IDS, SEED_ON_START=starter
docker compose --profile app up -d --build
```

Put an HTTPS reverse proxy in front of port 3000. [Caddy](https://caddyserver.com) does it in two lines: `your-domain { reverse_proxy localhost:3000 }`. Then continue from step 3.
