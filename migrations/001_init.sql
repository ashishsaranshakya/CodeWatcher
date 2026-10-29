CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  source_path TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE job_exclusions (
  exclusion_id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('directory_name', 'directory_pattern', 'file_pattern', 'relative_path')
  ),
  pattern TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  origin TEXT NOT NULL DEFAULT 'job' CHECK (origin IN ('default', 'preset', 'job')),
  UNIQUE (job_id, category, pattern, origin)
);

CREATE TABLE job_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_utc TEXT NOT NULL,
  finished_at_utc TEXT,
  exit_code INTEGER,
  summary TEXT
);

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX idx_job_exclusions_job ON job_exclusions(job_id, enabled);
CREATE INDEX idx_job_runs_job_started ON job_runs(job_id, started_at_utc DESC);
