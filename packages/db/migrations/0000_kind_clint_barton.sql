CREATE TYPE "public"."api_provider" AS ENUM('parsew', 'openrouter', 'autosend');--> statement-breakpoint
CREATE TYPE "public"."cadence" AS ENUM('daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scraper_kind" AS ENUM('css', 'extract');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'broken', 'dead');--> statement-breakpoint
CREATE TYPE "public"."subscription_kind" AS ENUM('home', 'trip');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'expired');--> statement-breakpoint
CREATE TABLE "api_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "api_provider" NOT NULL,
	"endpoint" text NOT NULL,
	"cost_units" numeric(14, 8) DEFAULT '0' NOT NULL,
	"source_id" uuid,
	"subscription_id" uuid,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"event_ids" uuid[] DEFAULT '{}' NOT NULL,
	"delivery_status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"autosend_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"venue_name" text,
	"venue_address" text,
	"venue_lat" real,
	"venue_lng" real,
	"price_text" text,
	"url" text NOT NULL,
	"image_url" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"language" text DEFAULT 'nl' NOT NULL,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrapers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"kind" "scraper_kind" NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"generated_by_model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"listing_url" text NOT NULL,
	"location_label" text NOT NULL,
	"location_key" text NOT NULL,
	"location_lat" real NOT NULL,
	"location_lng" real NOT NULL,
	"location_radius_km" real DEFAULT 25 NOT NULL,
	"language" text DEFAULT 'nl' NOT NULL,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"discovery_score" real
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_email" text NOT NULL,
	"kind" "subscription_kind" NOT NULL,
	"location_label" text NOT NULL,
	"location_key" text NOT NULL,
	"location_lat" real NOT NULL,
	"location_lng" real NOT NULL,
	"location_radius_km" real DEFAULT 25 NOT NULL,
	"interests" text[] DEFAULT '{}' NOT NULL,
	"cadence" "cadence" NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"last_digest_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_cadence_by_kind" CHECK (("subscriptions"."kind" = 'home') OR ("subscriptions"."kind" = 'trip' AND "subscriptions"."cadence" = 'daily'))
);
--> statement-breakpoint
ALTER TABLE "api_calls" ADD CONSTRAINT "api_calls_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_calls" ADD CONSTRAINT "api_calls_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrapers" ADD CONSTRAINT "scrapers_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_calls_occurred_at_idx" ON "api_calls" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "api_calls_provider_idx" ON "api_calls" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_sub_window_idx" ON "digest_runs" USING btree ("subscription_id","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_content_hash_idx" ON "events" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scrapers_source_version_idx" ON "scrapers" USING btree ("source_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scrapers_source_active_idx" ON "scrapers" USING btree ("source_id") WHERE "scrapers"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_listing_url_idx" ON "sources" USING btree ("listing_url");--> statement-breakpoint
CREATE INDEX "sources_location_key_status_idx" ON "sources" USING btree ("location_key","status");--> statement-breakpoint
CREATE INDEX "subscriptions_location_key_idx" ON "subscriptions" USING btree ("location_key");