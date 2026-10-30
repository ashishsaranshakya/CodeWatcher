import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExclusionRule,
  MirrorJob,
  SyncOutcome,
  SyncRunResult,
  SyncTrigger,
} from '../shared/jobs.ts';
import { DEFAULT_EXCLUSIONS, isExcluded } from './exclusions.ts';
import { assertMirrorFolders, validateMirrorPaths } from './path-safety.ts';
import { acquireProcessLock } from './process-lock.ts';
import type { JobRepository } from './repository.ts';
import { DiagnosticLogger } from './diagnostics.ts';

const OUTPUT_CAPTURE_LIMIT = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export interface RobocopyPlan {
  executable: string;
  args: string[];
}

export interface RobocopyProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMs: number;
  outcome: SyncOutcome;
}

interface CapturedOutput {
  text: string;
  truncated: boolean;
}

interface ExclusionPaths {
  directories: string[];
  exactFileNames: string[];
}

export function classifyRobocopyExitCode(exitCode: number): SyncOutcome {
  if (exitCode >= 8) return 'failure';
  return exitCode === 0 || exitCode === 1 ? 'success' : 'warning';
}

function validateRobocopyRules(rules: readonly ExclusionRule[]): void {
  for (const rule of rules) {
    if (rule.type === 'relative_path' && !rule.pattern.replace(/\\/g, '/').endsWith('/**')) {
      throw new Error(
        `Cannot copy with relative-path rule "${rule.pattern}". For now, relative-path exclusions must target a directory subtree ending in /**.`,
      );
    }
    if (
      rule.type === 'file_pattern' &&
      /[\\/]/.test(rule.pattern)
    ) {
      throw new Error(
        `Cannot translate file exclusion "${rule.pattern}" safely. File patterns must match a basename, not contain a path.`,
      );
    }
  }
}

async function collectExcludedDirectories(
  root: string,
  rules: readonly ExclusionRule[],
): Promise<ExclusionPaths> {
  const excluded: ExclusionPaths = { directories: [], exactFileNames: [] };

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const metadata = await lstat(fullPath);
      if (metadata.isSymbolicLink()) continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (metadata.isDirectory()) {
        if (isExcluded(relativePath, true, rules)) {
          excluded.directories.push(fullPath);
        } else {
          await visit(fullPath, relativePath);
        }
      } else {
        if (
          metadata.isFile() &&
          isExcluded(relativePath, false, rules) &&
          rules.some((rule) => rule.origin === 'preset' && rule.pattern.toLowerCase() === '.env.*')
        ) {
          const basename = entry.name.toLowerCase();
          if (!['.env.example', '.env.sample', '.env.template'].includes(basename)) {
            excluded.exactFileNames.push(entry.name);
          }
        }
      }
    }
  }

  await visit(root, '');
  return {
    directories: [...new Set(excluded.directories)],
    exactFileNames: [...new Set(excluded.exactFileNames)],
  };
}

export async function buildRobocopyPlan(
  source: string,
  destination: string,
  rules: readonly ExclusionRule[],
  dryRun = false,
): Promise<RobocopyPlan> {
  validateRobocopyRules(rules);
  const exclusions = await collectExcludedDirectories(source, rules);
  const filePatterns = [...new Set(
    [...DEFAULT_EXCLUSIONS, ...rules]
      .filter(
        (rule) =>
          rule.enabled &&
          rule.type === 'file_pattern' &&
          !(rule.origin === 'preset' && rule.pattern.toLowerCase() === '.env.*'),
      )
      .map((rule) => rule.pattern.trim()),
  )];
  const args = [
    source,
    destination,
    '/MIR',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/Z',
    '/R:2',
    '/W:2',
    '/XJ',
    '/NP',
    '/BYTES',
  ];
  if (dryRun) args.push('/L');
  if (exclusions.directories.length > 0) args.push('/XD', ...exclusions.directories);
  const excludedFileNames = [...new Set([...filePatterns, ...exclusions.exactFileNames])];
  if (excludedFileNames.length > 0) args.push('/XF', ...excludedFileNames);
  const commandLength = args.reduce((length, argument) => length + argument.length + 3, 0);
  if (commandLength > 28000) {
    throw new Error(
      'There are too many translated exclusions for a safe Robocopy command. Simplify the exclusions before copying.',
    );
  }
  return {
    executable: path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'robocopy.exe'),
    args,
  };
}

function appendOutput(target: CapturedOutput, chunk: Buffer): void {
  const remaining = OUTPUT_CAPTURE_LIMIT - Buffer.byteLength(target.text, 'utf8');
  if (remaining <= 0) {
    target.truncated = true;
    return;
  }
  const next = chunk.subarray(0, remaining).toString('utf8');
  target.text += next;
  if (next.length < chunk.length) target.truncated = true;
}

export function runRobocopyProcess(
  plan: RobocopyPlan,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void,
): Promise<RobocopyProcessResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const stdout: CapturedOutput = { text: '', truncated: false };
    const stderr: CapturedOutput = { text: '', truncated: false };
    const child = spawn(plan.executable, plan.args, {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    onSpawn?.(child);

    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => appendOutput(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => appendOutput(stderr, chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === null && !timedOut) {
        reject(new Error('Robocopy stopped without an exit code.'));
        return;
      }
      resolve({
        exitCode: code,
        stdout: stdout.text,
        stderr: stderr.text,
        outputTruncated: stdout.truncated || stderr.truncated,
        durationMs: Date.now() - started,
        outcome: timedOut ? 'timed_out' : classifyRobocopyExitCode(code!),
      });
    });
  });
}

function readJob(repository: JobRepository, jobId: string): MirrorJob {
  const job = repository.list().find((candidate) => candidate.id === jobId);
  if (!job) throw new Error('The mirror job no longer exists.');
  return job;
}

export class RobocopyService {
  private readonly repository: JobRepository;
  private readonly timeoutMs: number;
  private readonly restrictToSandbox: boolean;
  private readonly profileName: string;
  private readonly logger: DiagnosticLogger;
  private readonly active = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly activeJobs = new Set<string>();
  private readonly cancelledJobs = new Set<string>();
  private readonly activeRuns = new Map<string, Promise<SyncRunResult>>();
  private stopping = false;

  constructor(
    repository: JobRepository,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    restrictToSandbox = true,
    profileName = 'dev',
  ) {
    this.repository = repository;
    this.restrictToSandbox = restrictToSandbox;
    this.profileName = profileName;
    this.logger = new DiagnosticLogger(repository.getDiagnosticsDirectory());
    this.timeoutMs = Number.isFinite(timeoutMs)
      ? Math.min(Math.max(1000, timeoutMs), DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
  }

  runNow(jobId: string, trigger: SyncTrigger = 'manual'): Promise<SyncRunResult> {
    if (this.activeJobs.has(jobId)) throw new Error('This job is already synchronizing.');
    this.activeJobs.add(jobId);
    const run = this.executeRun(jobId, trigger).finally(() => {
      this.activeJobs.delete(jobId);
      this.activeRuns.delete(jobId);
      this.cancelledJobs.delete(jobId);
    });
    this.activeRuns.set(jobId, run);
    return run;
  }

  private async executeRun(jobId: string, trigger: SyncTrigger): Promise<SyncRunResult> {
    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    let outcome: SyncOutcome = 'failure';
    let exitCode: number | null = null;
    let summary = 'Copy did not complete.';
    let outputTruncated = false;
    let processLock: ReturnType<typeof acquireProcessLock> | undefined;

    this.logger.info('mirror_started', { profile: this.profileName, runId, jobId, trigger });
    try {
      processLock = acquireProcessLock(
        this.repository.getRunLockDirectory(),
        `profile:${this.profileName}:job:${jobId}`,
      );
      const job = readJob(this.repository, jobId);
      const pathValidation = validateMirrorPaths(job.sourcePath, job.destinationPath);
      if (!pathValidation.valid) throw new Error(pathValidation.reason);
      const safePaths = await assertMirrorFolders(
        job.sourcePath,
        job.destinationPath,
        false,
        this.restrictToSandbox,
      );
      if (this.stopping || this.cancelledJobs.has(jobId)) {
        outcome = 'cancelled';
        summary = 'The copy was cancelled before Robocopy started.';
        throw new Error(summary);
      }
      const plan = await buildRobocopyPlan(
        safePaths.sourcePath,
        safePaths.destinationPath,
        job.exclusions,
      );
      if (this.stopping || this.cancelledJobs.has(jobId)) {
        outcome = 'cancelled';
        summary = 'The copy was cancelled before Robocopy started.';
        throw new Error(summary);
      }
      const result = await runRobocopyProcess(plan, this.timeoutMs, (child) => {
        this.active.set(jobId, child);
      });
      exitCode = result.exitCode;
      outcome = this.cancelledJobs.has(jobId) ? 'cancelled' : result.outcome;
      outputTruncated = result.outputTruncated;
      summary =
        outcome === 'failure'
          ? `Robocopy mirror failed with exit code ${result.exitCode}; destination files may have been partially changed.`
          : outcome === 'warning'
            ? `Robocopy mirror completed with warnings (exit code ${result.exitCode}); review the destination for partial changes.`
            : outcome === 'cancelled'
              ? 'The mirror was cancelled; some destination changes may already have occurred.'
              : 'Robocopy mirror completed successfully.';
      if (outcome === 'timed_out') {
        summary = 'Robocopy exceeded its time limit and was stopped; destination files may have been partially changed.';
      }
    } catch (error) {
      if (this.cancelledJobs.has(jobId)) {
        outcome = 'cancelled';
        summary = 'The mirror was cancelled; some destination changes may already have occurred.';
      } else {
        outcome = 'failure';
        summary = error instanceof Error
          ? error.message
          : 'Robocopy could not be started; destination files may have been partially changed.';
      }
    } finally {
      this.active.delete(jobId);
      processLock?.release();
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;
    this.repository.recordRun({
      runId,
      jobId,
      trigger,
      outcome,
      startedAt,
      finishedAt,
      exitCode,
      summary,
      durationMs,
      outputTruncated,
    });

    this.logger.info('mirror_finished', {
      profile: this.profileName,
      runId,
      jobId,
      trigger,
      outcome,
      exitCode,
      durationMs,
      outputTruncated,
    });
    return {
      runId,
      jobId,
      trigger,
      outcome,
      exitCode,
      startedAt,
      finishedAt,
      durationMs,
      summary,
      outputTruncated,
    };
  }

  cancel(jobId: string): boolean {
    if (!this.activeJobs.has(jobId)) return false;
    this.cancelledJobs.add(jobId);
    const process = this.active.get(jobId);
    if (!process) return true;
    process.kill();
    return true;
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    for (const jobId of this.activeJobs) this.cancelledJobs.add(jobId);
    for (const [, process] of this.active) process.kill();
    await Promise.all([...this.activeRuns.values()].map((run) => run.then(() => undefined)));
  }

  isRunning(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }
}
