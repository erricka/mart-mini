ALTER TABLE "products" ADD COLUMN "sku" text;--> statement-breakpoint
CREATE UNIQUE INDEX "products_sku_uq" ON "products" USING btree ("sku");