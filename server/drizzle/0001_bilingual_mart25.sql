ALTER TABLE "shop_settings" ALTER COLUMN "shop_name" SET DEFAULT 'mart25';--> statement-breakpoint
ALTER TABLE "shop_settings" ALTER COLUMN "tagline" SET DEFAULT 'ទំនិញស្រស់ ពិន្ទុរង្វាន់រាល់ការទិញ';--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "levels" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "name_en" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "rewards" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "tagline_en" text;