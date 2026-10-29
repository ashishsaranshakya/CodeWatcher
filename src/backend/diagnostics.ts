import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { RunHistoryEntry } from '../shared/jobs.ts';

const LOG_FILE_NAME = 'app.jsonl';
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_BACKUP_COUNT = 3;
const MAX_EXPORTED_LOG_ENTRIES = 500;

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface DiagnosticLoggerOptions {
  maxBytes?: number;
  backupCount?: number;
}

export interface DiagnosticLogRecord {
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  [key: string]: unknown;
}

export interface DiagnosticBundle {
  schemaVersion: 1;
  collectedAt: string;
  application: {
    version: string;
    electronVersion: string;
    platform: string;
    architecture: string;
  };
  mirror: {
    configuredJobs: number;
    enabledJobs: number;
  };
  recentRuns: Array<Omit<RunHistoryEntry, 'runId' | 'jobId' | 'jobName'> & { job: string }>;
  recentLogs: DiagnosticLogRecord[];
}

export function redactDiagnosticText(value: string): string {
  return value.replace(/(?:[A-Za-z]:\\|\\\\).*/g, '[REDACTED_PATH]');
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (
    /^(?:source|destination)(?:path)?$|^(?:path|command|arguments|stdout|stderr|username|user)$/i.test(key)
  ) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
}

export function sanitizeDiagnosticRecord<T>(record: T): T {
  return sanitizeValue(record) as T;
}

export class DiagnosticLogger {
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly backupCount: number;

  constructor(directory: string, options: DiagnosticLoggerOptions = {}) {
    this.directory = directory;
    this.maxBytes = Math.max(1024, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.backupCount = Math.max(0, Math.floor(options.backupCount ?? DEFAULT_BACKUP_COUNT));
  }

  info(event: string, details: Record<string, unknown> = {}): void {
    this.write('info', event, details);
  }

  warning(event: string, details: Record<string, unknown> = {}): void {
    this.write('warning', event, details);
  }

  error(event: string, details: Record<string, unknown> = {}): void {
    this.write('error', event, details);
  }

  private write(
    level: DiagnosticLevel,
    event: string,
    details: Record<string, unknown>,
  ): void {
    const record = sanitizeDiagnosticRecord<DiagnosticLogRecord>({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details,
    });
    const line = `${JSON.stringify(record)}\n`;
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotateIfNeeded(Buffer.byteLength(line, 'utf8'));
      appendFileSync(join(this.directory, LOG_FILE_NAME), line, { encoding: 'utf8' });
    } catch (error) {
      console.error('Could not write CodeMirror diagnostic log entry:', error);
    }
  }

  private rotateIfNeeded(nextLineBytes: number): void {
    const activeLog = join(this.directory, LOG_FILE_NAME);
    if (!existsSync(activeLog) || statSync(activeLog).size + nextLineBytes <= this.maxBytes) return;
    if (this.backupCount === 0) {
      writeFileSync(activeLog, '');
      return;
    }

    const oldestBackup = join(this.directory, `${LOG_FILE_NAME}.${this.backupCount}`);
    if (existsSync(oldestBackup)) rmSync(oldestBackup);
    for (let index = this.backupCount - 1; index >= 1; index -= 1) {
      const previous = join(this.directory, `${LOG_FILE_NAME}.${index}`);
      if (existsSync(previous)) renameSync(previous, join(this.directory, `${LOG_FILE_NAME}.${index + 1}`));
    }
    renameSync(activeLog, join(this.directory, `${LOG_FILE_NAME}.1`));
  }
}

export function readDiagnosticLogs(directory: string): DiagnosticLogRecord[] {
  const fileNames = [
    ...Array.from({ length: DEFAULT_BACKUP_COUNT }, (_, index) => `${LOG_FILE_NAME}.${index + 1}`).reverse(),
    LOG_FILE_NAME,
  ];
  const records: DiagnosticLogRecord[] = [];
  for (const fileName of fileNames) {
    const filePath = join(directory, fileName);
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line);
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'timestamp' in parsed &&
          'level' in parsed &&
          'event' in parsed
        ) {
          records.push(sanitizeDiagnosticRecord(parsed as DiagnosticLogRecord));
        }
      } catch {
        records.push({
          timestamp: '',
          level: 'warning',
          event: 'malformed_log_entry_omitted',
        });
      }
    }
  }
  return records.slice(-MAX_EXPORTED_LOG_ENTRIES);
}

export function buildDiagnosticBundle(input: {
  version: string;
  electronVersion: string;
  platform: string;
  architecture: string;
  configuredJobs: number;
  enabledJobs: number;
  runs: readonly RunHistoryEntry[];
  logs: readonly DiagnosticLogRecord[];
}): DiagnosticBundle {
  const jobLabels = new Map<string, string>();
  const recentRuns = input.runs.map((run) => {
    let job = jobLabels.get(run.jobId);
    if (!job) {
      job = `Job ${jobLabels.size + 1}`;
      jobLabels.set(run.jobId, job);
    }
    const { runId: _runId, jobId: _jobId, jobName: _jobName, ...safeRun } = run;
    return {
      ...safeRun,
      job,
      summary: redactDiagnosticText(run.summary),
    };
  });
  const recentLogs = input.logs.map((record) => {
    const {
      jobId: _jobId,
      runId: _runId,
      ...safeRecord
    } = sanitizeDiagnosticRecord(record);
    return safeRecord as DiagnosticLogRecord;
  });
  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    application: {
      version: input.version,
      electronVersion: input.electronVersion,
      platform: input.platform,
      architecture: input.architecture,
    },
    mirror: {
      configuredJobs: input.configuredJobs,
      enabledJobs: input.enabledJobs,
    },
    recentRuns,
    recentLogs,
  };
}
