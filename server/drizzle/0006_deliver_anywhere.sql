ALTER TABLE "shop_settings" ALTER COLUMN "delivery_max_km" DROP DEFAULT;--> statement-breakpoint
-- mart25 delivers everywhere: remove the 20 km limit (can be set again in Settings).
UPDATE "shop_settings" SET "delivery_max_km" = NULL;
