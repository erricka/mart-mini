ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- mart25 has no free delivery (the $25 rule was a starter default). Re-enable any time in Settings.
UPDATE "shop_settings" SET "free_delivery_min_cents" = NULL;--> statement-breakpoint
-- "I can wait until tomorrow" = exactly $2.00 for every address.
UPDATE "shop_settings" SET "next_day_fee_cents" = 200, "next_day_enabled" = true WHERE "currency" = 'USD';
