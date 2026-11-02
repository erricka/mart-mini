CREATE TYPE "public"."customer_reward_source" AS ENUM('milestone', 'welcome', 'manual');--> statement-breakpoint
CREATE TYPE "public"."customer_reward_status" AS ENUM('available', 'used', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('percent', 'fixed', 'free_delivery', 'free_product');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_type" AS ENUM('delivery', 'pickup');--> statement-breakpoint
CREATE TYPE "public"."inventory_reason" AS ENUM('initial', 'order', 'cancel', 'restock', 'adjustment', 'gift');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'placed', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'ready_for_pickup', 'collected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'qr');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'paid', 'refunded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."points_type" AS ENUM('signup_bonus', 'order_earn', 'order_reversal', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."qr_payment_mode" AS ENUM('off', 'simulated', 'aba_payway');--> statement-breakpoint
CREATE TYPE "public"."redemption_status" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'staff', 'admin');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" text DEFAULT 'Home' NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"city" text NOT NULL,
	"postal_code" text,
	"instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"emoji" text DEFAULT '🛒' NOT NULL,
	"color" text DEFAULT '#22c55e' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"coupon_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"customer_reward_id" integer,
	"discount_cents" integer NOT NULL,
	"status" "redemption_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "coupon_redemptions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"free_product_id" integer,
	"min_subtotal_cents" integer DEFAULT 0 NOT NULL,
	"max_discount_cents" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"per_customer_limit" integer DEFAULT 1,
	"is_public" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code"),
	CONSTRAINT "coupons_redeemed_non_negative" CHECK ("coupons"."redeemed_count" >= 0),
	CONSTRAINT "coupons_value_non_negative" CHECK ("coupons"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reward_id" integer,
	"coupon_id" integer NOT NULL,
	"source" "customer_reward_source" NOT NULL,
	"status" "customer_reward_status" DEFAULT 'available' NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"order_id" integer,
	"expires_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"reason" "inventory_reason" NOT NULL,
	"order_id" integer,
	"actor_user_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emoji" text DEFAULT '⭐' NOT NULL,
	"min_points" integer NOT NULL,
	"multiplier_percent" integer DEFAULT 100 NOT NULL,
	"color" text DEFAULT '#22c55e' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "levels_min_points_unique" UNIQUE("min_points")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"chat_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"button_text" text,
	"button_path" text,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"order_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"kind" text NOT NULL,
	"status" "order_status",
	"payment_status" "payment_status",
	"note" text,
	"actor_user_id" integer,
	"actor_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '🛒' NOT NULL,
	"image_url" text,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"is_gift" boolean DEFAULT false NOT NULL,
	CONSTRAINT "order_items_qty_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"fulfillment_type" "fulfillment_type" NOT NULL,
	"status" "order_status" DEFAULT 'placed' NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"discount_cents" integer DEFAULT 0 NOT NULL,
	"delivery_fee_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"coupon_id" integer,
	"customer_reward_id" integer,
	"discount_label" text,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"postal_code" text,
	"address_instructions" text,
	"customer_note" text,
	"cancel_reason" text,
	"cancelled_by" text,
	"points_estimate" integer DEFAULT 0 NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"points_reversed" integer DEFAULT 0 NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_total_non_negative" CHECK ("orders"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"provider" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"provider_ref" text,
	"checkout_token" text,
	"qr_payload" text,
	"app_link" text,
	"reference" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_checkout_token_unique" UNIQUE("checkout_token")
);
--> statement-breakpoint
CREATE TABLE "points_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" "points_type" NOT NULL,
	"order_id" integer,
	"idempotency_key" text NOT NULL,
	"note" text,
	"actor_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"price_cents" integer NOT NULL,
	"compare_at_cents" integer,
	"stock" integer DEFAULT 0 NOT NULL,
	"emoji" text DEFAULT '🛒' NOT NULL,
	"image_url" text,
	"tags" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_stock_non_negative" CHECK ("products"."stock" >= 0),
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '🎁' NOT NULL,
	"points_required" integer NOT NULL,
	"coupon_id" integer NOT NULL,
	"is_surprise" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shop_name" text DEFAULT 'Sunny Market' NOT NULL,
	"tagline" text DEFAULT 'Fresh groceries, happy rewards' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"delivery_enabled" boolean DEFAULT true NOT NULL,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_fee_cents" integer DEFAULT 299 NOT NULL,
	"free_delivery_min_cents" integer,
	"min_order_cents" integer DEFAULT 0 NOT NULL,
	"pickup_address" text DEFAULT '' NOT NULL,
	"pickup_hours" text DEFAULT '' NOT NULL,
	"support_phone" text DEFAULT '' NOT NULL,
	"points_per_dollar" integer DEFAULT 1 NOT NULL,
	"signup_bonus_points" integer DEFAULT 50 NOT NULL,
	"welcome_coupon_id" integer,
	"reward_expiry_days" integer,
	"cash_enabled" boolean DEFAULT true NOT NULL,
	"qr_payment_mode" "qr_payment_mode" DEFAULT 'simulated' NOT NULL,
	"qr_payment_instructions" text DEFAULT 'Scan with ABA Mobile or any KHQR banking app, or tap "Open in ABA Mobile".' NOT NULL,
	"payment_window_minutes" integer DEFAULT 30 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_settings_singleton" CHECK ("shop_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "staff_login_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"username" text,
	"photo_url" text,
	"language_code" text,
	"phone" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"role" "user_role" DEFAULT 'customer' NOT NULL,
	"points_balance" integer DEFAULT 0 NOT NULL,
	"privacy_accepted_at" timestamp with time zone,
	"signup_source" text,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "welcome_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"phone_key" text,
	"points_granted" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "welcome_grants_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "welcome_grants_phone_key_unique" UNIQUE("phone_key")
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_free_product_id_products_id_fk" FOREIGN KEY ("free_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_rewards" ADD CONSTRAINT "customer_rewards_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_reward_id_customer_rewards_id_fk" FOREIGN KEY ("customer_reward_id") REFERENCES "public"."customer_rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_login_tokens" ADD CONSTRAINT "staff_login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_grants" ADD CONSTRAINT "welcome_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_user_idx" ON "coupon_redemptions" USING btree ("coupon_id","user_id");--> statement-breakpoint
CREATE INDEX "customer_rewards_user_idx" ON "customer_rewards" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_rewards_user_reward_uq" ON "customer_rewards" USING btree ("user_id","reward_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_rewards_one_welcome_uq" ON "customer_rewards" USING btree ("user_id") WHERE "customer_rewards"."source" = 'welcome';--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_order_idx" ON "notifications" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_uq" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_placed_at_idx" ON "orders" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX "points_transactions_user_idx" ON "points_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_id_uq" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");