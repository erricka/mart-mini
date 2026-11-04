CREATE TABLE "maps_usage" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "maps_usage_day_kind_pk" PRIMARY KEY("day","kind")
);
