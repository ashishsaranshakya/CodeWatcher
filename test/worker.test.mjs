import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { acquireProcessLock, ProcessLockUnavailableError } from '../src/backend/process-lock.ts';
import {
  runBackgroundWorker,
  runHeadlessWorkerOnce,
  shouldRunDebouncedChange,
} from '../src/backend/headless-worker.ts';
import { SANDBOX_ROOT } from '../src/backend/path-safety.ts';
import { JobRepository } from '../src/backend/repository.ts';

const migrationsDirectory = join(process.cwd(), 'migrations');

async function waitFor(check, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms.`);
}

describe('background worker foundation', () => {
  it('coalesces watcher events after quiet time or at the maximum wait', () => {
    const change = { firstAt: 100, lastAt: 500 };
    assert.equal(shouldRunDebouncedChange(change, 1499, 1000, 5000), false);
    assert.equal(shouldRunDebouncedChange(change, 1500, 1000, 5000), true);
    assert.equal(shouldRunDebouncedChange(change, 5100, 1000, 5000), true);
  });

  it('prevents a second process from acquiring the same lock and releases it on shutdown', async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-lock-test-'));
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'scripts', 'process-lock-holder.mjs'), directory, 'job:test'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const closed = once(child, 'close');
    let closedResult;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Lock-holder process did not acquire its lock.')), 5000);
        const onData = () => {
          if (!stdout.includes('LOCKED')) return;
          clearTimeout(timer);
          child.stdout.off('data', onData);
          resolve();
        };
        child.stdout.on('data', onData);
        child.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          reject(new Error(`Lock-holder exited before acquiring the lock (${code}): ${stderr}`));
        });
      });

      it('updates lock heartbeats in place while holding the lock', async () => {
        const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-heartbeat-test-'));
        const lock = acquireProcessLock(directory, 'heartbeat:test', 1000);
        const heartbeatPath = join(
          directory,
          `${createHash('sha256').update('heartbeat:test').digest('hex')}.json`,
        );
        try {
          const firstHeartbeat = JSON.parse(readFileSync(heartbeatPath, 'utf8')).updatedAt;
          await new Promise((resolve) => setTimeout(resolve, 1100));
          const nextHeartbeat = JSON.parse(readFileSync(heartbeatPath, 'utf8')).updatedAt;
          assert.notEqual(nextHeartbeat, firstHeartbeat);
        } finally {
          lock.release();
          rmSync(directory, { recursive: true, force: true });
        }
      });

      assert.throws(
        () => acquireProcessLock(directory, 'job:test'),
        ProcessLockUnavailableError,
      );
      child.stdin.write('release\n');
      closedResult = await closed;
      assert.equal(closedResult[0], 0, stderr);
      assert.match(stdout, /RELEASED/);

      const reacquired = acquireProcessLock(directory, 'job:test');
      reacquired.release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await closed;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs headlessly once, skips disabled jobs, and releases its worker lock', async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-worker-test-'));
    const databasePath = join(directory, 'worker.sqlite');
    try {
      const first = await runHeadlessWorkerOnce(databasePath, migrationsDirectory);
      assert.deepEqual(first, { status: 'completed', jobCount: 0, failedJobCount: 0 });

      const second = await runHeadlessWorkerOnce(databasePath, migrationsDirectory);
      assert.deepEqual(second, { status: 'completed', jobCount: 0, failedJobCount: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('shuts down an idle worker and releases its lock', async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-idle-worker-test-'));
    const databasePath = join(directory, 'worker.sqlite');
    try {
      const result = await runBackgroundWorker(
        databasePath,
        migrationsDirectory,
        new AbortController().signal,
        { refreshMs: 1000, idleShutdownMs: 0 },
      );
      assert.deepEqual(result, { status: 'completed', jobCount: 0, failedJobCount: 0 });
      assert.deepEqual(
        await runHeadlessWorkerOnce(databasePath, migrationsDirectory),
        { status: 'completed', jobCount: 0, failedJobCount: 0 },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('launches Electron in one-shot headless mode with isolated user data', {
    skip: process.platform !== 'win32',
  }, async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-electron-worker-test-'));
    const appDataPath = join(directory, 'appdata');
    mkdirSync(appDataPath);
    const child = spawn(
      join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe'),
      [process.cwd(), '--background-worker-once', '--profile=dev'],
      {
        env: { ...process.env, APPDATA: appDataPath },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const closed = once(child, 'close');
    const timeout = setTimeout(() => child.kill(), 20_000);
    try {
      const [code] = await closed;
      assert.equal(code, 0, `${stdout}\n${stderr}`);
      assert.match(stdout, /Background worker \(profile dev\) completed: 0 enabled job\(s\), 0 failure\(s\)/);
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await closed;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('mirrors startup and debounced changes, and retries a temporarily missing source', {
    skip: process.platform !== 'win32',
  }, async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-watcher-test-'));
    const sourcePath = join(directory, 'source');
    const destinationPath = join(directory, 'destination');
    const delayedSourcePath = join(directory, 'delayed-source');
    const delayedDestinationPath = join(directory, 'delayed-destination');
    mkdirSync(sourcePath);
    mkdirSync(destinationPath);
    mkdirSync(delayedDestinationPath);
    writeFileSync(join(sourcePath, 'startup.txt'), 'startup');
    const databasePath = join(directory, 'worker.sqlite');
    const repository = new JobRepository(databasePath, migrationsDirectory);
    const jobId = randomUUID();
    const delayedJobId = randomUUID();
    const timestamp = new Date().toISOString();
    repository.create({
      id: jobId,
      name: 'Watcher test',
      sourcePath,
      destinationPath,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      exclusions: [],
    });
    repository.create({
      id: delayedJobId,
      name: 'Retry test',
      sourcePath: delayedSourcePath,
      destinationPath: delayedDestinationPath,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      exclusions: [],
    });
    repository.close();

    const abortController = new AbortController();
    let worker;
    try {
      worker = runBackgroundWorker(
        databasePath,
        migrationsDirectory,
        abortController.signal,
        {
          debounceMs: 100,
          maxWaitMs: 500,
          refreshMs: 1000,
          retryDelaysMs: [300],
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      mkdirSync(delayedSourcePath);
      writeFileSync(join(delayedSourcePath, 'recovered.txt'), 'recovered');

      await waitFor(() => {
        const startupFile = join(destinationPath, 'startup.txt');
        return existsSync(startupFile) && readFileSync(startupFile, 'utf8') === 'startup';
      });

      writeFileSync(join(sourcePath, 'debounced.txt'), 'first');
      await new Promise((resolve) => setTimeout(resolve, 50));
      writeFileSync(join(sourcePath, 'debounced.txt'), 'second');
      await new Promise((resolve) => setTimeout(resolve, 50));
      writeFileSync(join(sourcePath, 'debounced.txt'), 'final');
      await waitFor(() => {
        const mirroredFile = join(destinationPath, 'debounced.txt');
        return existsSync(mirroredFile) && readFileSync(mirroredFile, 'utf8') === 'final';
      });

      await waitFor(() => {
        const recoveredFile = join(delayedDestinationPath, 'recovered.txt');
        return existsSync(recoveredFile) && readFileSync(recoveredFile, 'utf8') === 'recovered';
      });

      abortController.abort();
      const result = await worker;
      assert.equal(result.status, 'stopped');
      assert.equal(result.jobCount, 2);
      assert.equal(result.failedJobCount, 0);
    } finally {
      abortController.abort();
      if (worker) await worker;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('performs full reconciliation on the configured schedule before watcher debounce expires', {
    skip: process.platform !== 'win32',
  }, async () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-reconcile-test-'));
    const sourcePath = join(directory, 'source');
    const destinationPath = join(directory, 'destination');
    mkdirSync(sourcePath);
    mkdirSync(destinationPath);
    writeFileSync(join(sourcePath, 'startup.txt'), 'startup');
    const databasePath = join(directory, 'worker.sqlite');
    const repository = new JobRepository(databasePath, migrationsDirectory);
    const jobId = randomUUID();
    const timestamp = new Date().toISOString();
    repository.create({
      id: jobId,
      name: 'Reconciliation test',
      sourcePath,
      destinationPath,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      exclusions: [],
    });
    repository.close();

    const abortController = new AbortController();
    let worker;
    try {
      worker = runBackgroundWorker(
        databasePath,
        migrationsDirectory,
        abortController.signal,
        {
          debounceMs: 60_000,
          maxWaitMs: 60_000,
          dailyReconcileMs: 1000,
          refreshMs: 1000,
        },
      );
      await waitFor(() => {
        const startupFile = join(destinationPath, 'startup.txt');
        return existsSync(startupFile) && readFileSync(startupFile, 'utf8') === 'startup';
      });

      writeFileSync(join(sourcePath, 'daily.txt'), 'daily reconciliation');
      await waitFor(() => {
        const reconciledFile = join(destinationPath, 'daily.txt');
        return existsSync(reconciledFile) && readFileSync(reconciledFile, 'utf8') === 'daily reconciliation';
      });

      abortController.abort();
      const result = await worker;
      assert.equal(result.status, 'stopped');
      assert.equal(result.failedJobCount, 0);
    } finally {
      abortController.abort();
      if (worker) await worker;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
