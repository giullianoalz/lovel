-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('admin', 'teacher', 'student', 'parent');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "class_type" AS ENUM ('in-person', 'virtual', 'hybrid');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('scheduled', 'in-progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'late', 'excused');

-- CreateEnum
CREATE TYPE "prize_type" AS ENUM ('earned', 'redeemed');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('charge', 'payment', 'credit', 'refund');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('draft', 'sent', 'partial', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('stripe_card', 'paypal', 'venmo', 'zelle', 'scholarship_fes', 'scholarship_ema', 'cash', 'check', 'other');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');

-- CreateEnum
CREATE TYPE "scholarship_program" AS ENUM ('FES', 'EMA');

-- CreateEnum
CREATE TYPE "scholarship_status" AS ENUM ('pending', 'received', 'applied');

-- CreateEnum
CREATE TYPE "behavior_type" AS ENUM ('warning', 'slip', 'positive');

-- CreateEnum
CREATE TYPE "behavior_severity" AS ENUM ('minor', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "marketing_type" AS ENUM ('photos', 'student_of_week', 'activity_of_week');

-- CreateEnum
CREATE TYPE "chat_thread_status" AS ENUM ('active', 'resolved');

-- CreateEnum
CREATE TYPE "medical_status" AS ENUM ('recorded', 'reviewed');

-- CreateEnum
CREATE TYPE "behavior_status" AS ENUM ('recorded', 'downgraded', 'sent_to_parent');

-- CreateEnum
CREATE TYPE "lesson_plan_type" AS ENUM ('discovery_cove', 'elective');

-- CreateEnum
CREATE TYPE "lesson_plan_status" AS ENUM ('submitted', 'needs_revision', 'approved');

-- CreateEnum
CREATE TYPE "supply_status" AS ENUM ('pending', 'purchased');

-- CreateEnum
CREATE TYPE "time_off_type" AS ENUM ('pto', 'sick');

-- CreateEnum
CREATE TYPE "time_off_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firebase_uid" VARCHAR(128) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL,
    "phone" VARCHAR(20),
    "avatar_url" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "age" INTEGER,
    "allergies" TEXT,
    "snack_authorized" BOOLEAN NOT NULL DEFAULT false,
    "snack_punches" INTEGER NOT NULL DEFAULT 0,
    "prize_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "base_salary" DECIMAL(10,2),
    "per_session_rate" DECIMAL(10,2),
    "accommodation_notes" TEXT,
    "medical_notes" TEXT,
    "fcm_token" TEXT,
    "quiet_hours_start" VARCHAR(10),
    "quiet_hours_end" VARCHAR(10),
    "auto_responder_message" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50),
    "is_invoice_recipient" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(100),
    "teacher_id" UUID,
    "type" "class_type" NOT NULL DEFAULT 'in-person',
    "meeting_url" TEXT,
    "max_students" INTEGER NOT NULL DEFAULT 10,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "term_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_enrollments" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" "attendance_status" NOT NULL DEFAULT 'present',
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_notes" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "notes" TEXT,
    "visibility" VARCHAR(20) NOT NULL DEFAULT 'all',
    "recording_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_materials" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" VARCHAR(50),
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(100),
    "type" VARCHAR(50),
    "file_url" TEXT NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snack_items" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "cost_punches" INTEGER NOT NULL,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snack_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snack_purchases" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "snack_id" UUID NOT NULL,
    "punches_used" INTEGER NOT NULL,
    "purchased_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "snack_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prize_history" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "points" INTEGER NOT NULL,
    "type" "prize_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prize_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "student_id" UUID,
    "family_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "type" "transaction_type" NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoice_id" UUID,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_number" VARCHAR(20) NOT NULL,
    "family_id" UUID,
    "student_id" UUID,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date_range" VARCHAR(100),
    "po_numbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" VARCHAR(20),
    "subtotal" DECIMAL(10,2) NOT NULL,
    "processing_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "invoice_status" NOT NULL DEFAULT 'draft',
    "due_date" DATE,
    "stripe_payment_link" TEXT,
    "stripe_payment_link_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "family_id" UUID,
    "invoice_id" UUID,
    "amount" DECIMAL(10,2) NOT NULL,
    "processing_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(10,2),
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "stripe_payment_intent_id" VARCHAR(255),
    "stripe_charge_id" VARCHAR(255),
    "stripe_receipt_url" TEXT,
    "external_reference" VARCHAR(255),
    "notes" TEXT,
    "recorded_by" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scholarship_disbursements" (
    "id" UUID NOT NULL,
    "family_id" UUID,
    "student_id" UUID,
    "program" "scholarship_program" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "period" VARCHAR(50),
    "status" "scholarship_status" NOT NULL DEFAULT 'pending',
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scholarship_disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_settings" (
    "id" UUID NOT NULL,
    "stripe_account_id" VARCHAR(255),
    "pass_cc_fee_to_parent" BOOLEAN NOT NULL DEFAULT false,
    "cc_fee_percentage" DECIMAL(4,2) NOT NULL DEFAULT 2.90,
    "cc_fee_fixed" DECIMAL(4,2) NOT NULL DEFAULT 0.30,
    "accepted_methods" TEXT[] DEFAULT ARRAY['stripe_card', 'paypal', 'venmo', 'zelle', 'scholarship_fes', 'scholarship_ema', 'cash', 'check']::TEXT[],
    "auto_send_receipt" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255),
    "is_bot" BOOLEAN NOT NULL DEFAULT false,
    "status" "chat_thread_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participants" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_id" UUID,
    "text" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "channel" VARCHAR(20) NOT NULL DEFAULT 'in_app',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "reference_type" VARCHAR(50),
    "reference_id" UUID,
    "dedup_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "sms" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "author_id" UUID,
    "target_audience" VARCHAR(20) NOT NULL DEFAULT 'all',
    "category" VARCHAR(30) NOT NULL DEFAULT 'general',
    "image_url" TEXT,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_media" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL DEFAULT 'image',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_terms" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    "window1_opens_at" TIMESTAMPTZ(6) NOT NULL,
    "window2_opens_at" TIMESTAMPTZ(6) NOT NULL,
    "window3_opens_at" TIMESTAMPTZ(6) NOT NULL,
    "registration_closes" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_holds" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "priority_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_requests" (
    "id" UUID NOT NULL,
    "term_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "first_choice_class_id" UUID NOT NULL,
    "second_choice_class_id" UUID,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "request_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_logs" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "session_id" UUID,
    "place" VARCHAR(255),
    "rule_broken" VARCHAR(255),
    "type" "behavior_type" NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "behavior_severity" NOT NULL DEFAULT 'minor',
    "status" "behavior_status" NOT NULL DEFAULT 'recorded',
    "manager_notes" TEXT,
    "parent_notified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_fit_reports" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "session_id" UUID,
    "reason" TEXT NOT NULL,
    "suggestion" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_fit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_alerts" (
    "id" UUID NOT NULL,
    "student_id" UUID,
    "reported_by" UUID NOT NULL,
    "alertType" VARCHAR(50) NOT NULL,
    "reason" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,

    CONSTRAINT "class_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_submissions" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "week_of" DATE NOT NULL,
    "type" "marketing_type" NOT NULL,
    "title" VARCHAR(255),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'submitted',
    "drive_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_photos" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "drive_file_id" VARCHAR(255),
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_logs" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "time" TIMESTAMPTZ(6) NOT NULL,
    "place" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "actions_taken" TEXT NOT NULL,
    "sent_home" BOOLEAN NOT NULL DEFAULT false,
    "status" "medical_status" NOT NULL DEFAULT 'recorded',
    "manager_notes" TEXT,
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_plans" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "class_id" UUID,
    "week_of" DATE NOT NULL,
    "type" "lesson_plan_type" NOT NULL DEFAULT 'discovery_cove',
    "main_activity" TEXT NOT NULL,
    "materials" TEXT,
    "safety_notes" TEXT,
    "skill_connection" TEXT,
    "differentiation" TEXT,
    "status" "lesson_plan_status" NOT NULL DEFAULT 'submitted',
    "manager_feedback" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lesson_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_items" (
    "id" UUID NOT NULL,
    "lesson_plan_id" UUID,
    "teacher_id" UUID NOT NULL,
    "item_name" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "day_needed" VARCHAR(50),
    "status" "supply_status" NOT NULL DEFAULT 'pending',
    "cost" DECIMAL(10,2),
    "receipt_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off_requests" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "group_id" UUID,
    "type" "time_off_type" NOT NULL DEFAULT 'pto',
    "status" "time_off_status" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "manager_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_off_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_spaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "shared_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_reservations" (
    "id" UUID NOT NULL,
    "space_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "purpose" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temp_pickup_auths" (
    "id" UUID NOT NULL,
    "parent_id" UUID NOT NULL,
    "pickup_person" VARCHAR(255) NOT NULL,
    "valid_date" DATE NOT NULL,
    "qr_code_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temp_pickup_auths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "due_date" TIMESTAMPTZ(6) NOT NULL,
    "max_score" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "score" DECIMAL(10,2),
    "feedback" TEXT,
    "graded_at" TIMESTAMPTZ(6),

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_family_id_user_id_key" ON "family_members"("family_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_class_id_student_id_key" ON "class_enrollments"("class_id", "student_id");

-- CreateIndex
CREATE INDEX "sessions_class_id_idx" ON "sessions"("class_id");

-- CreateIndex
CREATE INDEX "sessions_date_idx" ON "sessions"("date");

-- CreateIndex
CREATE INDEX "attendance_student_id_idx" ON "attendance"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_session_id_student_id_key" ON "attendance"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "transactions_family_id_idx" ON "transactions"("family_id");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_family_id_idx" ON "invoices"("family_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "chat_participants_thread_id_user_id_key" ON "chat_participants"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "chat_messages_thread_id_idx" ON "chat_messages"("thread_id");

-- CreateIndex
CREATE INDEX "chat_messages_sent_at_idx" ON "chat_messages"("sent_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_dedup_key_idx" ON "notifications"("dedup_key");

-- CreateIndex
CREATE INDEX "notification_preferences_user_id_idx" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_key" ON "notification_preferences"("user_id", "category");

-- CreateIndex
CREATE INDEX "announcements_target_audience_idx" ON "announcements"("target_audience");

-- CreateIndex
CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at");

-- CreateIndex
CREATE INDEX "announcement_media_announcement_id_idx" ON "announcement_media"("announcement_id");

-- CreateIndex
CREATE INDEX "priority_holds_term_id_idx" ON "priority_holds"("term_id");

-- CreateIndex
CREATE INDEX "priority_holds_class_id_idx" ON "priority_holds"("class_id");

-- CreateIndex
CREATE INDEX "priority_holds_student_id_idx" ON "priority_holds"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "priority_holds_term_id_student_id_class_id_key" ON "priority_holds"("term_id", "student_id", "class_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_student_id_idx" ON "waitlist_entries"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_class_id_student_id_key" ON "waitlist_entries"("class_id", "student_id");

-- CreateIndex
CREATE INDEX "behavior_logs_student_id_idx" ON "behavior_logs"("student_id");

-- CreateIndex
CREATE INDEX "behavior_logs_teacher_id_idx" ON "behavior_logs"("teacher_id");

-- CreateIndex
CREATE INDEX "behavior_logs_created_at_idx" ON "behavior_logs"("created_at");

-- CreateIndex
CREATE INDEX "class_fit_reports_student_id_idx" ON "class_fit_reports"("student_id");

-- CreateIndex
CREATE INDEX "class_fit_reports_status_idx" ON "class_fit_reports"("status");

-- CreateIndex
CREATE INDEX "class_alerts_status_idx" ON "class_alerts"("status");

-- CreateIndex
CREATE INDEX "class_alerts_created_at_idx" ON "class_alerts"("created_at");

-- CreateIndex
CREATE INDEX "marketing_submissions_teacher_id_idx" ON "marketing_submissions"("teacher_id");

-- CreateIndex
CREATE INDEX "marketing_submissions_week_of_idx" ON "marketing_submissions"("week_of");

-- CreateIndex
CREATE UNIQUE INDEX "announcement_reads_user_id_announcement_id_key" ON "announcement_reads"("user_id", "announcement_id");

-- CreateIndex
CREATE INDEX "medical_logs_student_id_idx" ON "medical_logs"("student_id");

-- CreateIndex
CREATE INDEX "medical_logs_teacher_id_idx" ON "medical_logs"("teacher_id");

-- CreateIndex
CREATE INDEX "lesson_plans_teacher_id_idx" ON "lesson_plans"("teacher_id");

-- CreateIndex
CREATE INDEX "time_off_requests_group_id_idx" ON "time_off_requests"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "temp_pickup_auths_qr_code_hash_key" ON "temp_pickup_auths"("qr_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "grades_assignment_id_student_id_key" ON "grades"("assignment_id", "student_id");

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "registration_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_notes" ADD CONSTRAINT "session_notes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_materials" ADD CONSTRAINT "session_materials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snack_purchases" ADD CONSTRAINT "snack_purchases_snack_id_fkey" FOREIGN KEY ("snack_id") REFERENCES "snack_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snack_purchases" ADD CONSTRAINT "snack_purchases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_history" ADD CONSTRAINT "prize_history_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_disbursements" ADD CONSTRAINT "scholarship_disbursements_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_disbursements" ADD CONSTRAINT "scholarship_disbursements_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scholarship_disbursements" ADD CONSTRAINT "scholarship_disbursements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_media" ADD CONSTRAINT "announcement_media_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_holds" ADD CONSTRAINT "priority_holds_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_holds" ADD CONSTRAINT "priority_holds_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "priority_holds" ADD CONSTRAINT "priority_holds_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "registration_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_first_choice_class_id_fkey" FOREIGN KEY ("first_choice_class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_second_choice_class_id_fkey" FOREIGN KEY ("second_choice_class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_requests" ADD CONSTRAINT "registration_requests_term_id_fkey" FOREIGN KEY ("term_id") REFERENCES "registration_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "registration_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_logs" ADD CONSTRAINT "behavior_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_logs" ADD CONSTRAINT "behavior_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_logs" ADD CONSTRAINT "behavior_logs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_fit_reports" ADD CONSTRAINT "class_fit_reports_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_fit_reports" ADD CONSTRAINT "class_fit_reports_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_fit_reports" ADD CONSTRAINT "class_fit_reports_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_fit_reports" ADD CONSTRAINT "class_fit_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_fit_reports" ADD CONSTRAINT "class_fit_reports_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_alerts" ADD CONSTRAINT "class_alerts_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_alerts" ADD CONSTRAINT "class_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_alerts" ADD CONSTRAINT "class_alerts_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_submissions" ADD CONSTRAINT "marketing_submissions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_photos" ADD CONSTRAINT "marketing_photos_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "marketing_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_logs" ADD CONSTRAINT "medical_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_logs" ADD CONSTRAINT "medical_logs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_logs" ADD CONSTRAINT "medical_logs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_plans" ADD CONSTRAINT "lesson_plans_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_lesson_plan_id_fkey" FOREIGN KEY ("lesson_plan_id") REFERENCES "lesson_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off_requests" ADD CONSTRAINT "time_off_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_reservations" ADD CONSTRAINT "space_reservations_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "shared_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_reservations" ADD CONSTRAINT "space_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temp_pickup_auths" ADD CONSTRAINT "temp_pickup_auths_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

