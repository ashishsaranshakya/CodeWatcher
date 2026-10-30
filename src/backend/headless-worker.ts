import { watch, type FSWatcher } from 'node:fs';
import type { MirrorJob } from '../shared/jobs.ts';
import { isExcluded } from './exclusions.ts';
import { DiagnosticLogger } from './diagnostics.ts';
import {
  ProcessLockUnavailableError,
  acquireProcessLock,
  type ProcessLock,
} from './process-lock.ts';
import { JobRepository } from './repository.ts';
import { RobocopyService } from './robocopy.ts';

const DEFAULT_DEBOUNCE_MS = 10_000;
const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_REFRESH_MS = 5_000;
const DEFAULT_DAILY_RECONCILE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_SHUTDOWN_MS = 30_000;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const;

export interface HeadlessWorkerResult {
  status: 'completed' | 'already_running' | 'stopped';
  jobCount: number;
  failedJobCount: number;
}

export interface BackgroundWorkerOptions {
  profileName?: string;
  restrictToSandbox?: boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  refreshMs?: number;
  dailyReconcileMs?: number;
  idleShutdownMs?: number;
  retryDelaysMs?: readonly number[];
}

interface PendingChange {
  firstAt: number;
  lastAt: number;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout;
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, delayMs);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
}

export function shouldRunDebouncedChange(
  change: PendingChange,
  now: number,
  debounceMs: number,
  maxWaitMs: number,
): boolean {
  return now - change.lastAt >= debounceMs || now - change.firstAt >= maxWaitMs;
}

function isExcludedChange(job: MirrorJob, filename: string | Buffer | null): boolean {
  if (filename === null) return false;
  const relativePath = Buffer.isBuffer(filename) ? filename.toString() : filename;
  return (
    isExcluded(relativePath, false, job.exclusions) ||
    isExcluded(relativePath, true, job.exclusions)
  );
}

async function runEnabledJobs(
  jobs: readonly MirrorJob[],
  service: RobocopyService,
  trigger: 'startup' | 'watcher' | 'daily' | 'one-shot',
  profileName: string,
  logger: DiagnosticLogger,
  signal?: AbortSignal,
  maxRetries = 0,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<number> {
  const outcomes = await Promise.all(
    jobs.map(async (job) => {
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (signal?.aborted) return 1;
        try {
          const result = await service.runNow(job.id, trigger);
          logger.info('mirror_attempt_completed', {
            profile: profileName,
            trigger,
            jobId: job.id,
            attempt: attempt + 1,
            outcome: result.outcome,
          });
          if (result.outcome !== 'failure' && result.outcome !== 'timed_out') return 0;
          if (attempt === maxRetries || signal?.aborted) return 1;
        } catch (error) {
          logger.error('mirror_attempt_failed', {
            profile: profileName,
            trigger,
            jobId: job.id,
            attempt: attempt + 1,
            message: error instanceof Error ? error.message : String(error),
          });
          if (attempt === maxRetries || signal?.aborted) return 1;
        }
        const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 0;
        await waitForRetry(delay, signal);
      }
      return 1;
    }),
  );
  return outcomes.reduce<number>((total, outcome) => total + outcome, 0);
}

export async function runHeadlessWorkerOnce(
  databasePath: string,
  migrationsDirectory: string,
  options: Pick<BackgroundWorkerOptions, 'profileName' | 'restrictToSandbox'> = {},
): Promise<HeadlessWorkerResult> {
  const profileName = options.profileName ?? 'dev';
  const repository = new JobRepository(databasePath, migrationsDirectory);
  let workerLock: ProcessLock;
  try {
    workerLock = acquireProcessLock(
      repository.getRunLockDirectory(),
      `profile:${profileName}:background-worker`,
    );
  } catch (error) {
    repository.close();
    if (error instanceof ProcessLockUnavailableError) {
      return { status: 'already_running', jobCount: 0, failedJobCount: 0 };
    }
    throw error;
  }

  const logger = new DiagnosticLogger(repository.getDiagnosticsDirectory());
  logger.info('background_worker_started', { mode: 'one-shot', profile: profileName });
  try {
    const jobs = repository.list().filter((job) => job.enabled);
    const service = new RobocopyService(repository, undefined, options.restrictToSandbox, profileName);
    const failedJobCount = await runEnabledJobs(jobs, service, 'one-shot', profileName, logger);
    const result = { status: 'completed' as const, jobCount: jobs.length, failedJobCount };
    logger.info('background_worker_stopped', {
      profile: profileName,
      status: result.status,
      jobCount: result.jobCount,
      failedJobCount: result.failedJobCount,
    });
    return result;
  } finally {
    workerLock.release();
    repository.close();
  }
}

export async function runBackgroundWorker(
  databasePath: string,
  migrationsDirectory: string,
  signal: AbortSignal,
  options: BackgroundWorkerOptions = {},
): Promise<HeadlessWorkerResult> {
  const profileName = options.profileName ?? 'dev';
  const repository = new JobRepository(databasePath, migrationsDirectory);
  let workerLock: ProcessLock;
  try {
    workerLock = acquireProcessLock(
      repository.getRunLockDirectory(),
      `profile:${profileName}:background-worker`,
    );
  } catch (error) {
    repository.close();
    if (error instanceof ProcessLockUnavailableError) {
      return { status: 'already_running', jobCount: 0, failedJobCount: 0 };
    }
    throw error;
  }

  const service = new RobocopyService(repository, undefined, options.restrictToSandbox, profileName);
  const logger = new DiagnosticLogger(repository.getDiagnosticsDirectory());
  logger.info('background_worker_started', { mode: 'continuous', profile: profileName });
  const watchers = new Map<string, { signature: string; watcher: FSWatcher }>();
  const pending = new Map<string, PendingChange>();
  const debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  const maxWaitMs = Math.max(debounceMs, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  const refreshMs = Math.max(1000, options.refreshMs ?? DEFAULT_REFRESH_MS);
  const dailyReconcileMs = Math.max(0, options.dailyReconcileMs ?? DEFAULT_DAILY_RECONCILE_MS);
  const idleShutdownMs = Math.max(0, options.idleShutdownMs ?? DEFAULT_IDLE_SHUTDOWN_MS);
  const retryDelaysMs = (options.retryDelaysMs ?? RETRY_DELAYS_MS).map((delay) =>
    Number.isFinite(delay) ? Math.max(0, delay) : 0,
  );
  let enabledJobs: MirrorJob[] = [];
  let failedJobCount = 0;
  let nextFullReconcileAt = 0;
  let nextRefreshAt = 0;
  let ticking = false;
  let activeTick: Promise<void> | undefined;
  let configurationInitialized = false;
  let noEnabledSince: number | undefined;
  let resolveNoEnabledJobs: (() => void) | undefined;
  const noEnabledJobs = new Promise<void>((resolve) => {
    resolveNoEnabledJobs = resolve;
  });

  const stopWatchers = (): void => {
    for (const { watcher } of watchers.values()) watcher.close();
    watchers.clear();
    pending.clear();
  };

  const openWatcher = (job: MirrorJob, signature: string): void => {
    try {
      const watcher = watch(job.sourcePath, { recursive: true }, (_eventType, filename) => {
        if (isExcludedChange(job, filename)) return;
        const now = Date.now();
        const existing = pending.get(job.id);
        pending.set(job.id, {
          firstAt: existing?.firstAt ?? now,
          lastAt: now,
        });
      });
      watcher.on('error', (error) => {
        logger.warning('source_watcher_failed', {
          profile: profileName,
          jobId: job.id,
          message: error.message,
        });
        watcher.close();
        watchers.delete(job.id);
      });
      watchers.set(job.id, { signature, watcher });
    } catch (error) {
      logger.warning('source_watcher_unavailable', {
        profile: profileName,
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const refreshConfiguration = (): void => {
    const currentJobs = repository.list().filter((job) => job.enabled);
    const byId = new Map(currentJobs.map((job) => [job.id, job]));

    for (const [jobId, existing] of watchers) {
      if (!byId.has(jobId)) {
        existing.watcher.close();
        watchers.delete(jobId);
        pending.delete(jobId);
      }
    }

    const previousJobs = new Map(enabledJobs.map((job) => [job.id, job]));
    for (const job of currentJobs) {
      const signature = JSON.stringify([
        job.sourcePath,
        job.destinationPath,
        job.exclusions,
      ]);
      const existing = watchers.get(job.id);
      if (existing?.signature === signature) continue;
      existing?.watcher.close();
      openWatcher(job, signature);
      if (previousJobs.has(job.id)) {
        const now = Date.now();
        pending.set(job.id, { firstAt: now, lastAt: now });
      } else if (configurationInitialized) {
        const now = Date.now();
        pending.set(job.id, { firstAt: now - debounceMs, lastAt: now - debounceMs });
      }
    }
    enabledJobs = currentJobs;
    configurationInitialized = true;
  };

  const runPending = async (): Promise<void> => {
    const now = Date.now();
    for (const job of enabledJobs) {
      const change = pending.get(job.id);
      if (!change || service.isRunning(job.id)) continue;
      if (!shouldRunDebouncedChange(change, now, debounceMs, maxWaitMs)) continue;
      pending.delete(job.id);
      failedJobCount += await runEnabledJobs(
        [job],
        service,
        'watcher',
        profileName,
        logger,
        signal,
        retryDelaysMs.length,
        retryDelaysMs,
      );
    }
  };

  const reconcile = async (): Promise<void> => {
    refreshConfiguration();
    failedJobCount += await runEnabledJobs(
      enabledJobs,
      service,
      'daily',
      profileName,
      logger,
      signal,
      retryDelaysMs.length,
      retryDelaysMs,
    );
    nextFullReconcileAt = Date.now() + dailyReconcileMs;
  };

  const tick = async (): Promise<void> => {
    if (ticking || signal.aborted) return;
    ticking = true;
    try {
      const now = Date.now();
      if (now >= nextRefreshAt) {
        refreshConfiguration();
        nextRefreshAt = now + refreshMs;
      }
      if (enabledJobs.length === 0) {
        noEnabledSince ??= now;
        if (now - noEnabledSince >= idleShutdownMs) resolveNoEnabledJobs?.();
      } else {
        noEnabledSince = undefined;
      }
      if (enabledJobs.length > 0 && now >= nextFullReconcileAt) await reconcile();
      await runPending();
      workerLock.heartbeat();
    } catch (error) {
      logger.error('background_worker_cycle_failed', {
        profile: profileName,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    if (activeTick) return;
    activeTick = tick().finally(() => {
      activeTick = undefined;
    });
  }, 1000);
  timer.unref();
  const abort = (): void => {
    stopWatchers();
  };
  signal.addEventListener('abort', abort, { once: true });

  try {
    refreshConfiguration();
    failedJobCount += await runEnabledJobs(
      enabledJobs,
      service,
      'startup',
      profileName,
      logger,
      signal,
      retryDelaysMs.length,
      retryDelaysMs,
    );
    nextFullReconcileAt = Date.now() + dailyReconcileMs;
    nextRefreshAt = Date.now() + refreshMs;
    if (!signal.aborted) {
      let onStopped: (() => void) | undefined;
      const stopped = new Promise<void>((resolve) => {
        onStopped = () => resolve();
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', onStopped, { once: true });
      });
      await Promise.race([stopped, noEnabledJobs]);
      if (onStopped) signal.removeEventListener('abort', onStopped);
    }
    await service.stopAll();
    await activeTick;
    const result: HeadlessWorkerResult = {
      status: signal.aborted ? 'stopped' : 'completed',
      jobCount: enabledJobs.length,
      failedJobCount,
    };
    logger.info('background_worker_stopped', {
      profile: profileName,
      status: result.status,
      jobCount: result.jobCount,
      failedJobCount: result.failedJobCount,
    });
    return result;
  } finally {
    clearInterval(timer);
    signal.removeEventListener('abort', abort);
    stopWatchers();
    workerLock.release();
    repository.close();
  }
}
