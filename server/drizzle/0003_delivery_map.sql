ALTER TABLE "addresses" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "addresses" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lat" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_lng" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_distance_km" double precision;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_speed" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_date" date;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "delivery_pricing" text DEFAULT 'distance' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "store_lat" double precision;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "store_lng" double precision;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "store_maps_url" text;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "delivery_base_cents" integer DEFAULT 38 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "delivery_per_km_cents" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "delivery_min_fee_cents" integer DEFAULT 63 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "delivery_max_km" integer DEFAULT 20;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "next_day_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "next_day_fee_cents" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
-- mart25's store pin (the server turns this Google Maps link into coordinates on start-up).
UPDATE "shop_settings" SET "store_maps_url" = 'https://maps.app.goo.gl/1oWhhoUpnBVtErKN8' WHERE "store_maps_url" IS NULL;--> statement-breakpoint
-- Shops priced in riel get the same Grab-style rates in riel (amounts are stored ×100).
UPDATE "shop_settings" SET "delivery_base_cents" = 150000, "delivery_per_km_cents" = 100000, "delivery_min_fee_cents" = 250000, "next_day_fee_cents" = 800000 WHERE "currency" = 'KHR';
