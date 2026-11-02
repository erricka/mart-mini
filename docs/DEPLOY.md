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
2. Choose a display name (e.g. *mart25*) and a username ending in `bot` (e.g. `mart25_bot`).
3. BotFather replies with a **token** like `7123456789:AAH...`. **Keep it secret.** Anyone with it controls your bot.
4. Find **your own Telegram user ID**: open **[@userinfobot](https://t.me/userinfobot)** and press Start. Note the number after `Id:`. This becomes the shop admin.

Optional branding in BotFather: `/setuserpic` (logo), `/setdescription` (shown before Start), `/setabouttext`.

## 2. Deploy to Render

1. Render Dashboard → **New → Blueprint** → connect GitHub → choose the repository.
   Render reads `render.yaml` and proposes a **web service** (`mart25`) and a **PostgreSQL database**, both in Singapore.
2. Fill in the values it asks for:

   | Key | Value |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | the token from BotFather |
   | `TELEGRAM_BOT_USERNAME` | the bot username **without** `@` |
   | `ADMIN_TELEGRAM_IDS` | your user ID from @userinfobot (comma-separate several admins) |

   Everything else is set automatically: the session secret, webhook secret, database connection, migrations, the public URL, and **starter shop data on first boot**.
3. Click **Apply**. The first build takes a few minutes.
4. When it's live, copy the service URL, e.g. `https://mart25.onrender.com`. Opening it in a normal browser shows *"Open in Telegram"*. That's expected: the app only signs people in through Telegram.
5. Check the service **Logs**. You should see:

   ```
   🌱 First boot: creating the mart25 starter setup …
   Telegram webhook registered
   Bot menu button → https://mart25.onrender.com (mart25)
   🛒 API ready on :10000 — notifications via Telegram, dev login off
   ```

## 3. Connect the bot to the Mini App

The server has already set the bot's **menu button** (🛒 ទិញទំនិញ) and commands, in Khmer, with English descriptions for Telegram apps set to English. One step in BotFather enables QR-code links:

1. BotFather → `/mybots` → your bot → **Bot Settings → Configure Mini App → Enable Mini App**.
2. Send your Render URL (`https://mart25.onrender.com`).

You can now open **`https://t.me/<your_bot>?startapp=store`**, which is what the QR codes point to.

> Optional: `/newapp` in BotFather creates a named Mini App with a short name (e.g. `shop`). Set `TELEGRAM_MINIAPP_SHORT_NAME=shop` in Render and QR links become `https://t.me/<your_bot>/shop?startapp=store`.

## 4. Open it in Telegram

**As the admin (your account):**

1. Open your bot → **Start** → tap the **🛒 ទិញទំនិញ** button next to the message box.
2. Because your ID is in `ADMIN_TELEGRAM_IDS`, you go straight in, with no onboarding.
3. Send **`/dashboard`** to the bot. You get two buttons:
   - **📋 Open dashboard here:** the seller dashboard inside Telegram (works on Telegram Desktop too).
   - **🖥️ Open in browser:** a one-time login link for a computer browser, valid for 10 minutes.

**As a new customer (use a second Telegram account or a friend's phone):** scan a QR code or open `https://t.me/<your_bot>?startapp=store`. You'll see:

1. **language choice (ភាសាខ្មែរ / English)**
1. welcome screen
2. name and phone
3. privacy notice
4. celebration with welcome points
5. Start Shopping

## 5. Set up the shop (dashboard)

1. **ការកំណត់ (Settings):**
   - support phone, pickup address and hours
   - delivery fee, free-delivery threshold, minimum order
   - currency (USD or KHR)
   - tagline in Khmer, with optional English

   The shop name is already **mart25**. Payments are **cash only** (see *Payments* below).
2. **ទំនិញ (Catalog): add your products.** The catalog starts empty. The 9 aisles already exist, in Khmer and English. There are two buttons at the top right of the page:
   - **➕ បន្ថែមទំនិញ (Add product):** add one product with:
     - **Khmer name**, and an optional **English name**
     - aisle, price, and an optional "was" price for promotions
     - starting stock and barcode/SKU
     - photo (📷 upload; square works best)
   - **📥 នាំចូលពី Excel (Import from Excel):** upload your whole product list at once. See *Adding products from Excel* below.

   Products you hide (*Visible* off) or that run out of stock can't be ordered. Customers see "out of stock".
3. **កម្មវិធីសមាជិក (Loyalty):**
   - points per dollar, welcome bonus, welcome coupon
   - levels and milestone rewards. These are pre-filled in Khmer and English: free delivery at 100 points, $3 off at 250, $5 off at 500, $10 off at 1000. You can add free-product gifts once products exist.
4. **Staff:** each staff member opens the shop once in Telegram. Then go to **Customers → their name → Account role → Staff**, and they can use `/dashboard`.
5. **កូដ QR (QR codes):** download the PNGs or print the posters. Posters are always **bilingual** (Khmer and English). Use the store poster at the entrance and checkouts and the receipt code in the receipt footer. Insights shows which code brings sign-ups.

**Before printing, test end to end:** place an order with the second account, accept it in the dashboard, mark it *Delivered*/*Collected*, and check that the customer receives Telegram messages and points.

## Adding products from Excel

1. **Dashboard → ទំនិញ → 📥 នាំចូលពី Excel → ⬇ ទាញយកគំរូ (Download template).** You get `mart25-products-template.csv`, which opens in Excel or Google Sheets.
2. Put **one product per row**. Keep the first row (the column names) as it is.

   | Column | Required | Example |
   | --- | --- | --- |
   | `name_km` | ✅ | ទឹកដូង |
   | `category` | ✅ | ភេសជ្ជៈ. Use an existing aisle name (Khmer or English). A new name creates a new aisle. |
   | `price` | ✅ | `1.99`, or `4000` if your currency is KHR |
   | `name_en` | | Coconut Water |
   | `stock` | | `45` (empty = 0 for new products) |
   | `unit` | | `1 L`, `500 g`, `6 pcs` |
   | `sku` | | the barcode, e.g. `8850000000011` |
   | `compare_at_price` | | the old price for a promotion (shows ~~$2.50~~) |
   | `description_km`, `description_en` | | short description |
   | `emoji` | | 🥥 (shown until you add a photo; defaults to the aisle's emoji) |
   | `image_url` | | an `https://` link to a photo |
   | `featured` | | `yes` puts it under *Popular* on the home screen |
   | `active` | | `no` keeps it hidden from customers |

   Khmer column names also work (`ឈ្មោះ`, `ប្រភេទ`, `តម្លៃ`, `ស្តុក`, `បាកូដ`).
3. Save as **.xlsx** or **.csv (UTF-8)** and upload it. Nothing is saved yet: you'll see a preview where each row is marked **ថ្មី (New)**, **កែប្រែ (Update)** or **កំហុស (Error)** with the reason.
4. Tap **នាំចូលទំនិញ N (Import N products)**. Rows with errors are skipped. Fix them in the file and upload again.

**Updating prices or stock in bulk:** upload the same sheet again with new numbers. A row whose **barcode/SKU** (or, without a barcode, the same **Khmer name**) already exists updates that product instead of adding a duplicate. Empty cells leave the current value unchanged. Stock changes are recorded in the stock history as "Import (row N)".

**Photos:** after importing, open a product → **កែប្រែ (Edit) → 📷 ផ្ទុករូបថត (Upload photo)**. Or put photo links in `image_url` before importing.

## Payments

**Cash only for now:** cash on delivery, or pay at the counter for pickup. Orders reach the shop immediately. Staff tap **💵 បានទទួលប្រាក់ (Mark paid)** when they collect the money. Online / QR payment (e.g. ABA) can be added later. The earlier QR flow is kept in the git history (commit `4c24b89`).

## Languages

- Customers choose **ភាសាខ្មែរ** or **English** on their first visit and can switch in **គណនី (Profile)**.
- Bot messages follow each person's choice.
- Staff switch language in the dashboard sidebar or in Settings.
- `DEFAULT_LANGUAGE=km` is the language before anyone has chosen.

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
