ALTER TABLE job_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE job_runs ADD COLUMN output_truncated INTEGER NOT NULL DEFAULT 0 CHECK (output_truncated IN (0, 1));
