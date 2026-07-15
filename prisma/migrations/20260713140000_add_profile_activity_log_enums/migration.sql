-- Migration: add_profile_activity_log_enums
-- Applied via prisma db push. Recorded here for history tracking.

-- CreateEnum: role
CREATE TYPE IF NOT EXISTS "public"."role" AS ENUM (
  'super_admin',
  'admin'
);

-- CreateEnum: order_status
CREATE TYPE IF NOT EXISTS "public"."order_status" AS ENUM (
  'new',
  'needs_review',
  'quoted',
  'awaiting_payment',
  'payment_proof_received',
  'payment_verified',
  'processing',
  'ready_for_dispatch',
  'assigned_to_delivery',
  'out_for_delivery',
  'delivered',
  'closed',
  'cancelled'
);

-- CreateTable: profiles
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id"                   UUID          NOT NULL,
    "email"                VARCHAR(255)  NOT NULL,
    "role"                 "public"."role" NOT NULL DEFAULT 'admin',
    "first_name"           VARCHAR(100)  NOT NULL,
    "middle_name"          VARCHAR(100),
    "last_name"            VARCHAR(100)  NOT NULL,
    "phone_number"         VARCHAR(50),
    "state"                VARCHAR(100),
    "country"              VARCHAR(100),
    "date_of_birth"        DATE,
    "terms_and_conditions" BOOLEAN       NOT NULL DEFAULT false,
    "is_email_verified"    BOOLEAN       NOT NULL DEFAULT false,
    "created_at"           TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "job_title"            VARCHAR(100),
    "timezone"             VARCHAR(100),
    "user_profile_image"   TEXT,
    "otp_count"            INTEGER       NOT NULL DEFAULT 0,
    "otp_generated_at"     TIMESTAMP(6),
    "company_id"           UUID,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable: admin_activity_log
CREATE TABLE IF NOT EXISTS "public"."admin_activity_log" (
    "id"            UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "activity"      TEXT         NOT NULL,
    "activity_type" VARCHAR(100) NOT NULL,
    "details"       TEXT,
    "metadata"      JSONB,
    "created_at"    TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id"       UUID         NOT NULL,

    CONSTRAINT "admin_activity_log_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "profiles_email_key" ON "public"."profiles"("email");
CREATE INDEX IF NOT EXISTS "admin_activity_log_user_id_idx"       ON "public"."admin_activity_log"("user_id");
CREATE INDEX IF NOT EXISTS "admin_activity_log_activity_type_idx" ON "public"."admin_activity_log"("activity_type");
CREATE INDEX IF NOT EXISTS "admin_activity_log_created_at_idx"    ON "public"."admin_activity_log"("created_at");

-- Foreign Keys
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."admin_activity_log"
  ADD CONSTRAINT "admin_activity_log_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
