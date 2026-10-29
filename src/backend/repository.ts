import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ExclusionRule,
  ExclusionType,
  MirrorJob,
  RunHistoryEntry,
  SyncOutcome,
  SyncRunResult,
  SyncTrigger,
} from '../shared/jobs.ts';
import { pathsOverlap } from './path-safety.ts';
import { redactDiagnosticText } from './diagnostics.ts';

const RUN_HISTORY_RETENTION_LIMIT = 1000;

function readText(row: Record<string, SQLOutputValue>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Database value "${key}" is not text.`);
  }
  return value;
}

function rowToJob(row: Record<string, SQLOutputValue>): MirrorJob {
  const enabled = row.enabled;
  if (enabled !== 0 && enabled !== 1) {
    throw new Error('Database value "enabled" is not a valid boolean.');
  }
  return {
    id: readText(row, 'job_id'),
    name: readText(row, 'name'),
    sourcePath: readText(row, 'source_path'),
    destinationPath: readText(row, 'destination_path'),
    enabled: enabled === 1,
    createdAt: readText(row, 'created_at_utc'),
    updatedAt: readText(row, 'updated_at_utc'),
    exclusions: [],
  };
}

function rowToExclusion(row: Record<string, SQLOutputValue>): ExclusionRule {
  const enabled = row.enabled;
  const type = readText(row, 'category');
  const origin = readText(row, 'origin');
  if (enabled !== 0 && enabled !== 1) throw new Error('Invalid exclusion enabled value.');
  if (!['directory_name', 'directory_pattern', 'file_pattern', 'relative_path'].includes(type)) {
    throw new Error('Invalid exclusion category in database.');
  }
  if (!['default', 'preset', 'job'].includes(origin)) {
    throw new Error('Invalid exclusion origin in database.');
  }
  const id = row.exclusion_id;
  if (typeof id !== 'number') throw new Error('Invalid exclusion ID in database.');
  return {
    id,
    type: type as ExclusionType,
    pattern: readText(row, 'pattern'),
    enabled: enabled === 1,
    origin: origin as ExclusionRule['origin'],
  };
}

export class JobRepository {
  private readonly db: DatabaseSync;
  private readonly runLockDirectory: string;
  private readonly diagnosticsDirectory: string;

  constructor(databasePath: string, migrationsDirectory: string) {
    this.runLockDirectory = join(dirname(databasePath), 'run-locks');
    this.diagnosticsDirectory = join(dirname(databasePath), 'logs');
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
      this.migrate(migrationsDirectory);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  getRunLockDirectory(): string {
    return this.runLockDirectory;
  }

  getDiagnosticsDirectory(): string {
    return this.diagnosticsDirectory;
  }

  private migrate(migrationsDirectory: string): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at_utc TEXT NOT NULL
      );
    `);
    const migrations = readdirSync(migrationsDirectory)
      .filter((name) => /^\d{3,}_[a-z0-9_-]+\.sql$/i.test(name))
      .map((name) => ({
        name,
        version: Number.parseInt(name, 10),
      }))
      .sort((left, right) => left.version - right.version);
    if (migrations.length === 0) throw new Error('No database migrations were found.');

    const seenVersions = new Set<number>();
    for (const migration of migrations) {
      if (seenVersions.has(migration.version)) {
        throw new Error(`Duplicate database migration version ${migration.version}.`);
      }
      seenVersions.add(migration.version);
      const applied = this.db
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .get(migration.version);
      if (applied) continue;

      this.db.exec('BEGIN IMMEDIATE;');
      try {
        this.db.exec(readFileSync(join(migrationsDirectory, migration.name), 'utf8'));
        this.db
          .prepare('INSERT INTO schema_migrations (version, applied_at_utc) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
        this.db.exec('COMMIT;');
      } catch (error) {
        this.db.exec('ROLLBACK;');
        throw new Error(`Database migration ${migration.name} failed.`, { cause: error });
      }
    }
  }

  list(): MirrorJob[] {
    return this.db
      .prepare(`
        SELECT job_id, name, source_path, destination_path, enabled, created_at_utc, updated_at_utc
        FROM jobs
        ORDER BY name COLLATE NOCASE, created_at_utc
      `)
      .all()
      .map((row) => {
        const job = rowToJob(row);
        job.exclusions = this.listExclusions(job.id);
        return job;
      });
  }

  listExclusions(jobId: string): ExclusionRule[] {
    return this.db
      .prepare(`
        SELECT exclusion_id, category, pattern, enabled, origin
        FROM job_exclusions
        WHERE job_id = ?
        ORDER BY exclusion_id
      `)
      .all(jobId)
      .map(rowToExclusion);
  }

  replaceExclusions(jobId: string, rules: readonly ExclusionRule[]): ExclusionRule[] {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.db.prepare('SELECT job_id FROM jobs WHERE job_id = ?').get(jobId);
      if (!existing) throw new Error('The mirror job no longer exists.');
      this.db
        .prepare("DELETE FROM job_exclusions WHERE job_id = ? AND origin IN ('job', 'preset')")
        .run(jobId);
      const insert = this.db.prepare(`
        INSERT INTO job_exclusions (job_id, category, pattern, enabled, origin)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const rule of rules) {
        insert.run(jobId, rule.type, rule.pattern.trim(), rule.enabled ? 1 : 0, rule.origin);
      }
      this.db.exec('COMMIT;');
      return this.listExclusions(jobId);
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  recordRun(
    run: Pick<
      SyncRunResult,
      | 'runId'
      | 'jobId'
      | 'trigger'
      | 'outcome'
      | 'startedAt'
      | 'finishedAt'
      | 'exitCode'
      | 'durationMs'
      | 'summary'
      | 'outputTruncated'
    >,
  ): void {
    this.db
      .prepare(`
        INSERT INTO job_runs (
          run_id, job_id, trigger_type, status, started_at_utc, finished_at_utc,
          exit_code, summary, duration_ms, output_truncated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        run.runId,
        run.jobId,
        run.trigger,
        run.outcome,
        run.startedAt,
        run.finishedAt,
        run.exitCode,
        run.summary,
        run.durationMs,
        run.outputTruncated ? 1 : 0,
      );
    this.db
      .prepare(`
        DELETE FROM job_runs
        WHERE run_id NOT IN (
          SELECT run_id FROM job_runs
          ORDER BY started_at_utc DESC, run_id DESC
          LIMIT ?
        )
      `)
      .run(RUN_HISTORY_RETENTION_LIMIT);
  }

  listRunHistory(limit = 100): RunHistoryEntry[] {
    const boundedLimit = Math.min(RUN_HISTORY_RETENTION_LIMIT, Math.max(1, Math.floor(limit)));
    return this.db
      .prepare(`
        SELECT r.run_id, r.job_id, j.name AS job_name, r.trigger_type, r.status,
               r.started_at_utc, r.finished_at_utc, r.exit_code, r.duration_ms,
               r.summary, r.output_truncated
        FROM job_runs r
        JOIN jobs j ON j.job_id = r.job_id
        ORDER BY r.started_at_utc DESC, r.run_id DESC
        LIMIT ?
      `)
      .all(boundedLimit)
      .map((row) => {
        const triggerValue = readText(row, 'trigger_type');
        const outcomeValue = readText(row, 'status');
        const finishedAt = row.finished_at_utc;
        const exitCode = row.exit_code;
        const durationMs = row.duration_ms;
        const outputTruncated = row.output_truncated;
        let trigger: SyncTrigger;
        if (triggerValue === 'manual-copy') {
          trigger = 'manual';
        } else if (['manual', 'startup', 'watcher', 'daily', 'one-shot'].includes(triggerValue)) {
          trigger = triggerValue as SyncTrigger;
        } else {
          throw new Error(`Unknown mirror run trigger "${triggerValue}" in the database.`);
        }
        if (!['success', 'warning', 'failure', 'cancelled', 'timed_out'].includes(outcomeValue)) {
          throw new Error(`Unknown mirror run outcome "${outcomeValue}" in the database.`);
        }
        if (finishedAt !== null && typeof finishedAt !== 'string') {
          throw new Error('Database value "finished_at_utc" is not text or null.');
        }
        if (exitCode !== null && typeof exitCode !== 'number') {
          throw new Error('Database value "exit_code" is not numeric or null.');
        }
        if (durationMs !== null && typeof durationMs !== 'number') {
          throw new Error('Database value "duration_ms" is not numeric or null.');
        }
        if (outputTruncated !== 0 && outputTruncated !== 1) {
          throw new Error('Database value "output_truncated" is not a valid boolean.');
        }
        return {
          runId: readText(row, 'run_id'),
          jobId: readText(row, 'job_id'),
          jobName: readText(row, 'job_name'),
          trigger,
          outcome: outcomeValue as SyncOutcome,
          startedAt: readText(row, 'started_at_utc'),
          finishedAt,
          exitCode,
          durationMs,
          summary: redactDiagnosticText(readText(row, 'summary')),
          outputTruncated: outputTruncated === 1,
        };
      });
  }

  create(job: MirrorJob): MirrorJob {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const existingJobs = this.list();
      if (
        existingJobs.some(
          (existing) =>
            existing.name.toLocaleLowerCase('en-US') === job.name.toLocaleLowerCase('en-US'),
        )
      ) {
        throw new Error('A job with this name already exists.');
      }
      if (
        existingJobs.some(
          (existing) =>
            pathsOverlap(job.destinationPath, existing.destinationPath) ||
            pathsOverlap(job.destinationPath, existing.sourcePath) ||
            pathsOverlap(job.sourcePath, existing.destinationPath),
        )
      ) {
        throw new Error('This source or destination overlaps a folder used by another job.');
      }

      this.db
        .prepare(`
          INSERT INTO jobs (
            job_id, name, name_key, source_path, destination_path, enabled, created_at_utc, updated_at_utc
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          job.id,
          job.name,
          job.name.toLocaleLowerCase('en-US'),
          job.sourcePath,
          job.destinationPath,
          job.enabled ? 1 : 0,
          job.createdAt,
          job.updatedAt,
        );
      this.db.exec('COMMIT;');
      return job;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    }
  }

  delete(jobId: string): boolean {
    const result = this.db.prepare('DELETE FROM jobs WHERE job_id = ?').run(jobId);
    return result.changes === 1;
  }

  setEnabled(jobId: string, enabled: boolean): boolean {
    const result = this.db
      .prepare('UPDATE jobs SET enabled = ?, updated_at_utc = ? WHERE job_id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), jobId);
    return result.changes === 1;
  }

  close(): void {
    this.db.close();
  }
}
