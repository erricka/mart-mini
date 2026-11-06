CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"address" text DEFAULT '' NOT NULL,
	"hours" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"maps_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "branch_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "branch_name" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The existing store becomes branch 1 (same pin, Maps link, pickup address and hours).
INSERT INTO "branches" ("name", "name_en", "address", "hours", "lat", "lng", "maps_url", "sort_order")
SELECT "shop_name" || ' — សាខា ១', "shop_name" || ' — Branch 1', "pickup_address", "pickup_hours", "store_lat", "store_lng", "store_maps_url", 0
FROM "shop_settings" WHERE "id" = 1;
