-- Run history for the scheduled jobs in server/src/jobs/cron.jobs.js, so the
-- startup catch-up can tell which schedules elapsed while the server was down.
-- Additive: rows are created lazily on the first boot after this ships, seeded
-- at "now" so the rollout itself does not fire every job at once.
CREATE TABLE "cron_job_runs" (
    "id" UUID NOT NULL,
    "job_name" VARCHAR(100) NOT NULL,
    "last_run_at" TIMESTAMPTZ(6),
    "last_status" VARCHAR(20) NOT NULL DEFAULT 'ok',
    "last_error" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cron_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cron_job_runs_job_name_key" ON "cron_job_runs"("job_name");
