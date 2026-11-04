# Going live: production setup and opening the app in Telegram

About 30–45 minutes, no server administration needed. You'll do four things:

1. Create the Telegram bot.
2. Deploy the app to Render (free hosting, Singapore) with a free Neon database.
3. Connect the bot to the app.
4. Set up the shop in the dashboard and print the QR codes.

You need:

- a Telegram account (two accounts or a friend's phone help for testing)
- this code on GitHub: **[github.com/erricka/mart-mini](https://github.com/erricka/mart-mini)**
- a [Render](https://dashboard.render.com/register) account (sign up with GitHub). The app runs on Render's **free** plan.
- a [Neon](https://console.neon.tech/signup) account for the database. The free plan has no expiry and needs no card.

**Cost: $0.** On Render's free plan the app sleeps after 15 minutes without visitors, and the next visitor waits about a minute while it wakes. Telegram resends bot messages while it wakes. For an always-on shop, switch the service to Render's **Starter** plan (about US$7/month). Nothing else changes.

## Quick links

Open these in order:

| Step | Link | What to do there |
| --- | --- | --- |
| 1 | **[@BotFather](https://t.me/BotFather)** | Send `/newbot` and copy the **token** |
| 1 | **[@userinfobot](https://t.me/userinfobot)** | Press Start and copy your **ID** |
| 2 | **[Sign up / log in to Render](https://dashboard.render.com/register)** | Choose *GitHub* to sign in |
| 2 | **[One-click deploy of mart-mini](https://render.com/deploy?repo=https://github.com/erricka/mart-mini)** | Paste the token, bot username and ID, then click **Apply** |
| 3 | **[@BotFather](https://t.me/BotFather)** | `/mybots` → your bot → *Bot Settings → Configure Mini App* → paste your Render URL |
| 4 | `https://t.me/<your_bot>` | Press **Start** → 🛒 ទិញទំនិញ, then send `/dashboard` |

Or click the button:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/erricka/mart-mini)

### Write your values here as you go

Keep the token private. Write it down on paper or in a password manager, not in this file.

| What | Your value |
| --- | --- |
| Bot username (without `@`) | `________________bot` |
| Your Telegram ID (admin) | `______________` |
| Render URL | `https://____________.onrender.com` |
| Bot link (open the shop) | `https://t.me/________________bot` |
| QR / customer link | `https://t.me/________________bot?startapp=store` |
| Render dashboard (logs, settings) | [dashboard.render.com](https://dashboard.render.com) |

---

## 1. Create the Telegram bot

1. In Telegram, open **[@BotFather](https://t.me/BotFather)** (tap the link on your phone, or search *BotFather* with the blue ✓) and send `/newbot`.
2. Choose a display name (e.g. *mart25*) and a username ending in `bot` (e.g. `mart25_bot`).
3. BotFather replies with a **token** like `7123456789:AAH...`. **Keep it secret.** Anyone with it controls your bot.
4. Find **your own Telegram user ID**: open **[@userinfobot](https://t.me/userinfobot)** and press Start. Note the number after `Id:`. This becomes the shop admin.

Optional branding in BotFather: `/setuserpic` (logo), `/setdescription` (shown before Start), `/setabouttext`.

## 2. Deploy to Render

1. Log in to Render ([dashboard.render.com](https://dashboard.render.com), signing in with GitHub), then open the one-click link:
   **[render.com/deploy?repo=https://github.com/erricka/mart-mini](https://render.com/deploy?repo=https://github.com/erricka/mart-mini)**

   If you prefer doing it by hand: [Render Blueprints](https://dashboard.render.com/blueprints) → **New Blueprint Instance** → connect GitHub → choose **erricka/mart-mini** (branch `main`).
   Either way, Render reads [`render.yaml`](../render.yaml) and proposes a **free web service** (`mart25`) in Singapore. Choose a **Blueprint name**, e.g. *mart25*.
2. Fill in the values it asks for:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | your **Neon** connection string. Create a project at [console.neon.tech](https://console.neon.tech) (region **AWS Asia Pacific (Singapore)**), click **Connect**, turn **Connection pooling off**, then copy the `postgresql://…neon.tech/neondb?sslmode=require` line |
   | `TELEGRAM_BOT_TOKEN` | the token from BotFather |
   | `TELEGRAM_BOT_USERNAME` | the bot username **without** `@` |
   | `ADMIN_TELEGRAM_IDS` | your user ID from @userinfobot (comma-separate several admins) |

   Everything else is set automatically: the session secret, webhook secret, migrations, the public URL, and **starter shop data on first boot**.
3. Click **Apply**. The first build takes a few minutes.
4. When it's live, open the service in the [Render dashboard](https://dashboard.render.com) and copy the URL shown under its name, e.g. `https://mart25.onrender.com`. Opening it in a normal browser shows *"Open in Telegram"*. That's expected: the app only signs people in through Telegram.
5. Check the service **Logs** (left menu). You should see:

   ```
   🌱 First boot: creating the mart25 starter setup …
   Telegram webhook registered
   Bot menu button → https://mart25.onrender.com (mart25)
   🛒 API ready on :10000 — notifications via Telegram, dev login off
   ```

## 3. Connect the bot to the Mini App

The server has already set the bot's **menu button** (🛒 ទិញទំនិញ) and commands, in Khmer, with English descriptions for Telegram apps set to English. One step in BotFather enables QR-code links:

1. Open **[@BotFather](https://t.me/BotFather)** → send `/mybots` → your bot → **Bot Settings → Configure Mini App → Enable Mini App**.
2. Send your Render URL (`https://mart25.onrender.com`).

(Telegram's own reference on Mini Apps: [core.telegram.org/bots/webapps](https://core.telegram.org/bots/webapps).)

You can now open **`https://t.me/<your_bot>?startapp=store`**, which is what the QR codes point to.

> Optional: `/newapp` in BotFather creates a named Mini App with a short name (e.g. `shop`). Set `TELEGRAM_MINIAPP_SHORT_NAME=shop` in Render and QR links become `https://t.me/<your_bot>/shop?startapp=store`.

## 4. Open it in Telegram

**As the admin (your account):**

1. Open your bot at `https://t.me/<your_bot>` → **Start** → tap the **🛒 ទិញទំនិញ** button next to the message box.
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
   - free-delivery threshold, minimum order
   - currency (USD or KHR)
   - tagline in Khmer, with optional English
   - **🛵 Delivery fee & store location:** check that the 🏪 pin is on your shop (see *Delivery fee by distance* below)

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

## Delivery fee by distance (map)

At checkout, customers choosing delivery **drop a pin on a map**: they move the map until the pin is on their door, or tap **📍 ប្រើទីតាំងខ្ញុំ (Use my location)**. The fee is worked out on the server from the distance between your store and that pin.

- **Today (⚡ ថ្ងៃនេះ):** priced by distance: **base fare + price per km**, never below a **minimum fee**, rounded up to 5¢ (or 100៛). The distance is the straight line × 1.3, which approximates the road distance.
- **Tomorrow (📅 ថ្ងៃស្អែក):** if the customer can wait until the next day, a flat **$2.00**. It's never more than the same-day price.
- Spending above the **free-delivery threshold** makes either option free, and free-delivery rewards also apply.
- Pins farther than the **farthest delivery** distance (20 km by default) can't order delivery. Those customers are asked to choose pickup.

**Default prices:** **៛1,500 base, ៛1,000 per km, ៛2,500 minimum**, about $0.38, $0.25 and $0.63. That gives roughly:

| Distance | 1 km | 3 km | 5 km | 10 km |
| --- | --- | --- | --- | --- |
| Today | $0.65 | $1.15 | $1.65 | $2.90 |
| Tomorrow | $0.65 | $1.15 | $1.65 | $2.00 |

You can change every number in **Dashboard → ការកំណត់ (Settings) → 🛵 Delivery fee & store location**. The example table updates as you type. To match local delivery prices, compare a few real quotes from your shop to nearby areas and adjust.

**Store location.** The server reads mart25's Google Maps link (`https://maps.app.goo.gl/1oWhhoUpnBVtErKN8`) on start-up and places the 🏪 pin. The log shows `📍 Store location set from the Maps link`. Check it in Settings and **Save**. To move it: drag the map, or paste a Google Maps link (in Google Maps: **Share → Copy link**) or coordinates like `11.5564, 104.9282`, then tap **ស្វែងរក (Find)**. Until a pin is set, delivery uses the flat **delivery fee**.

**For staff.** New-order Telegram alerts say ⚡ *today* or 📅 *tomorrow* (with the date), the distance, and an **Open map** link with the route from the store. In the dashboard, next-day orders are marked **📅 ថ្ងៃស្អែក** in the order list, and the order page has **📍 Exact pin** and **🧭 Route from store** buttons.

**Which map.** With a Google Maps key (next section), customers get **Google Maps**, and moving the pin **fills in the address automatically**: street, sangkat, khan and city. They add their house number or floor. Without a key, or if Google can't load, the app uses the free [OpenStreetMap](https://www.openstreetmap.org/copyright) map. That map has no auto-fill and no bill. Dashboard → Settings shows which one is active.

## Google Maps (address auto-fill)

About 10 minutes. Google requires a billing account, but a small shop normally stays inside the free monthly usage. Since March 2025 that is 10,000 map loads and 10,000 address look-ups per month. Check [Google Maps Platform pricing](https://mapsplatform.google.com/pricing/) for current numbers.

1. **Create a project:** [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate), and name it e.g. *mart25*.
2. **Turn on billing:** [console.cloud.google.com/billing](https://console.cloud.google.com/billing). Link a billing account to the project.
3. **Enable the two APIs** (open each, choose your project, click **Enable**):
   - [Maps JavaScript API](https://console.cloud.google.com/apis/library/maps-backend.googleapis.com)
   - [Geocoding API](https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com)
4. **Create the key:** [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials → API key**. Then edit it:
   - **Application restrictions → Websites:** add `https://mart25.onrender.com/*`. Add your own domain too if you set one up later.
   - **API restrictions → Restrict key:** tick **Maps JavaScript API** and **Geocoding API**.
   - **Save.**
5. **Add it to Render:** service **mart25 → Environment → Add environment variable**. Set `GOOGLE_MAPS_API_KEY` to the key, then **Save**. Render restarts the app.
6. **Check:** Dashboard → Settings → 🛵 should say *"Google Maps is on"*. In Telegram, start a delivery order and move the pin: the street and city fill in.

**It stays free, enforced in two layers:**
1. **The app counts every Google use.** At most **300 Google maps and 300 address lookups a day**, and never more than **9,000 of each a month** (Google's free amount is 10,000). Beyond that, customers get the free OpenStreetMap map and type the address themselves, and Google isn't called at all. Settings → 🛵 shows this month's count. You can change the limits with the `MAPS_DAILY_LIMIT` / `MAPS_MONTHLY_LIMIT` environment variables. Address lookups only happen while a customer is entering a **new** address.
2. **A hard cap in Google (recommended):** it also stops anyone who copies the key. In Google Cloud, open [Maps JavaScript API → Quotas](https://console.cloud.google.com/apis/api/maps-backend.googleapis.com/quotas), find **Map loads per day**, choose **Edit**, and set **300**. Then open [Geocoding API → Quotas](https://console.cloud.google.com/apis/api/geocoding-backend.googleapis.com/quotas), find **Requests per day**, and set **300**. 300 a day × 31 days stays below 10,000.

Also set a [budget alert](https://console.cloud.google.com/billing/budgets) of $1, so Google emails you if anything is ever charged.

This key is a *browser* key. It's visible in the page by design, and the website restriction from step 4 is what protects it. If the checkout still shows the OpenStreetMap map after you add the key, Google rejected it for this site. Check the restriction in step 4. The server log also reports any blocked Google requests (`CSP violation`).

## Payments

**Cash only for now:** cash on delivery, or pay at the counter for pickup. Orders reach the shop immediately. Staff tap **💵 បានទទួលប្រាក់ (Mark paid)** when they collect the money. Online / QR payment (e.g. ABA) can be added later. The earlier QR flow is kept in the git history (commit `4c24b89`).

## Languages

- Customers choose **ភាសាខ្មែរ** or **English** on their first visit and can switch in **គណនី (Profile)**.
- Bot messages follow each person's choice.
- Staff switch language in the dashboard sidebar or in Settings.
- `DEFAULT_LANGUAGE=km` is the language before anyone has chosen.

## Day-to-day

- **Updates:** push to `main` on [GitHub](https://github.com/erricka/mart-mini) and Render redeploys automatically. Database migrations run on boot. You can follow it under the service's **Events** in the [Render dashboard](https://dashboard.render.com).
- **Photos:** stored in the database (shrunk to at most 1000 px before upload), so they survive deploys and need no disk.
- **Backups:** Neon keeps a short restore history on the free plan. See the project's **Backup & restore** page. For extra safety, export the data now and then.
- **Free limits:** Neon free gives 1 GB of storage and 100 compute-hours a month. The database pauses after 5 minutes without queries, so a quiet shop uses far less. A dashboard left **on screen** all day keeps it awake (minimise it when you're not using it; new-order alerts still come through Telegram). Render's 750 free hours a month are shared by all free services in your workspace.
- **Moving to another database later:** set `NEW_DATABASE_URL` to the new (empty) database. On its next start the app copies everything from the current `DATABASE_URL` into it and switches over. Then set `DATABASE_URL` to the new one.
- **Custom domain (optional):** Render → service → Settings → Custom Domains ([guide](https://render.com/docs/custom-domains)). Then set `PUBLIC_URL=https://shop.yourdomain.com` and update the Mini App URL in [@BotFather](https://t.me/BotFather).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| *"We couldn't verify your Telegram session"* | `TELEGRAM_BOT_TOKEN` doesn't match the bot you opened (or you revoked the token). Update it in Render and redeploy. |
| Bot doesn't answer `/start` or `/dashboard` | Check the logs for *Telegram webhook registered*. Open `https://api.telegram.org/bot<TOKEN>/getWebhookInfo` in a browser: `url` should be your Render URL and `last_error_message` empty. |
| No 🛒 Shop button | Close and reopen the chat. It's set on boot when the URL is https. You can also set it in BotFather → `/setmenubutton`. |
| Customers don't get order messages | They must allow messages. The app asks during onboarding and after an order (“Get order updates in Telegram”). Customers who pressed Start in the bot chat always receive them. |
| `/dashboard` says *staff only* | Add your user ID (from [@userinfobot](https://t.me/userinfobot)) to `ADMIN_TELEGRAM_IDS` in Render → service → **Environment**, or have an admin set your role to Staff. |
| Need help with Render itself | [Render docs: Blueprints](https://render.com/docs/infrastructure-as-code) · [Render status](https://status.render.com) |
| First load is slow (about 1 minute) | The free instance was asleep. It's normal on the free plan. Switch to Starter for an always-on shop. |

## Alternative: your own server (VPS)

On any Linux VPS with Docker (e.g. a Singapore region):

```bash
git clone https://github.com/erricka/mart-mini.git && cd mart-mini
cp .env.example .env
# edit .env: NODE_ENV=production, SESSION_SECRET, PUBLIC_URL=https://your-domain,
# TELEGRAM_* values, TELEGRAM_BOT_MODE=webhook, TELEGRAM_WEBHOOK_SECRET, ADMIN_TELEGRAM_IDS, SEED_ON_START=starter
docker compose --profile app up -d --build
```

Put an HTTPS reverse proxy in front of port 3000. [Caddy](https://caddyserver.com) does it in two lines: `your-domain { reverse_proxy localhost:3000 }`. Then continue from step 3.
