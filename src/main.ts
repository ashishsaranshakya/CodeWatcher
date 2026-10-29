import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JobService } from './backend/jobs';
import { assertSandboxFolder, SANDBOX_ROOT, validateMirrorPaths } from './backend/path-safety';
import { JobRepository } from './backend/repository';
import { RobocopyService } from './backend/robocopy';
import { runBackgroundWorker, runHeadlessWorkerOnce } from './backend/headless-worker';
import { TaskSchedulerService } from './backend/task-scheduler';
import {
  buildDiagnosticBundle,
  DiagnosticLogger,
  readDiagnosticLogs,
} from './backend/diagnostics';
import type { CreateJobInput, ExclusionRule } from './shared/jobs';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let jobService: JobService | undefined;
let jobRepository: JobRepository | undefined;
let robocopyService: RobocopyService | undefined;
let quitAfterStopping = false;
const isOneShotBackgroundWorker = process.argv.includes('--background-worker-once');
const isBackgroundWorker =
  isOneShotBackgroundWorker || process.argv.includes('--background-worker');
const backgroundWorkerAbort = new AbortController();
let backgroundWorkerStopping = false;

function assertMainFrame(event: Electron.IpcMainInvokeEvent): void {
  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC request did not originate from the main frame.');
  }
}

function requireJobService(): JobService {
  if (!jobService) {
    throw new Error('Job storage is not available.');
  }
  return jobService;
}

function isCreateJobInput(value: unknown): value is CreateJobInput {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.sourcePath === 'string' &&
    typeof candidate.destinationPath === 'string'
  );
}

function isExclusionRules(value: unknown): value is ExclusionRule[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (rule) =>
      typeof rule === 'object' &&
      rule !== null &&
      ['directory_name', 'directory_pattern', 'file_pattern', 'relative_path'].includes(rule.type) &&
      typeof rule.pattern === 'string' &&
      typeof rule.enabled === 'boolean' &&
      ['job', 'preset'].includes(rule.origin),
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.setName('CodeMirror');
app.setPath('userData', join(app.getPath('appData'), 'CodeMirror'));

const hasSingleInstanceLock = isBackgroundWorker || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  const migrationsDirectory = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(app.getAppPath(), 'migrations');
  const databasePath = join(app.getPath('userData'), 'codemirror.sqlite');
  if (isBackgroundWorker) {
    const worker = isOneShotBackgroundWorker
      ? runHeadlessWorkerOnce(databasePath, migrationsDirectory)
      : runBackgroundWorker(
          databasePath,
          migrationsDirectory,
          backgroundWorkerAbort.signal,
        );
    void worker.then(
      (result) => {
        console.log(
          `Background worker ${result.status}: ${result.jobCount} enabled job(s), ${result.failedJobCount} failure(s).`,
        );
        app.exit(result.failedJobCount > 0 ? 1 : 0);
      },
      (error: unknown) => {
        console.error('Background worker failed:', error);
        app.exit(1);
      },
    );
    return;
  }

  jobRepository = new JobRepository(databasePath, migrationsDirectory);
  jobService = new JobService(jobRepository);
  robocopyService = new RobocopyService(jobRepository);
  const diagnosticLogger = new DiagnosticLogger(jobRepository.getDiagnosticsDirectory());
  const taskScheduler = new TaskSchedulerService();
  const workerCommand = {
    executable: process.execPath,
    args: [
      ...(!app.isPackaged ? [app.getAppPath()] : []),
      '--background-worker',
    ],
  };

  ipcMain.handle('app:get-version', (event) => {
    assertMainFrame(event);
    return app.getVersion();
  });

  ipcMain.handle('paths:validate', (event, source: unknown, destination: unknown) => {
    assertMainFrame(event);
    if (typeof source !== 'string' || typeof destination !== 'string') {
      throw new TypeError('Source and destination must be strings.');
    }

    return validateMirrorPaths(source, destination);
  });

  ipcMain.handle('jobs:list', (event) => {
    assertMainFrame(event);
    return requireJobService().list();
  });

  ipcMain.handle('diagnostics:list-runs', (event) => {
    assertMainFrame(event);
    if (!jobRepository) throw new Error('Run history is not available.');
    return jobRepository.listRunHistory(100);
  });

  ipcMain.handle('diagnostics:export', async (event) => {
    assertMainFrame(event);
    if (!jobRepository || !jobService) throw new Error('Diagnostics are not available.');
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog({
      title: 'Export CodeMirror diagnostics',
      defaultPath: join(app.getPath('documents'), `CodeMirror-diagnostics-${stamp}.json`),
      filters: [{ name: 'JSON diagnostics', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;

    const jobs = jobService.list();
    const bundle = buildDiagnosticBundle({
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      platform: process.platform,
      architecture: process.arch,
      configuredJobs: jobs.length,
      enabledJobs: jobs.filter((job) => job.enabled).length,
      runs: jobRepository.listRunHistory(100),
      logs: readDiagnosticLogs(jobRepository.getDiagnosticsDirectory()),
    });
    await writeFile(result.filePath, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'w',
    });
    diagnosticLogger.info('diagnostics_exported', { runCount: bundle.recentRuns.length });
    return true;
  });

  ipcMain.handle('jobs:create', (event, input: unknown) => {
    assertMainFrame(event);
    if (!isCreateJobInput(input)) {
      throw new TypeError('Invalid mirror job configuration.');
    }
    return requireJobService().create(input);
  });

  ipcMain.handle('jobs:set-enabled', async (event, jobId: unknown, enabled: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string' || typeof enabled !== 'boolean') {
      throw new TypeError('Invalid job ID or automation setting.');
    }

    const service = requireJobService();
    const existing = service.list().find((job) => job.id === jobId);
    if (!existing) throw new Error('The mirror job no longer exists.');
    if (existing.enabled === enabled) return existing;

    if (enabled) {
      const updated = await service.setEnabled(jobId, true);
      try {
        const workerIsRunning = await taskScheduler.isRunning();
        await taskScheduler.ensureRegistered(workerCommand, {
          runImmediately: !workerIsRunning,
        });
      } catch (error) {
        try {
          await service.setEnabled(jobId, false);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Task Scheduler registration failed and the job could not be rolled back.',
          );
        }
        throw error;
      }
      return updated;
    }

    const updated = await service.setEnabled(jobId, false);
    const remainingEnabledJobs = service.list().some((job) => job.enabled);
    if (!remainingEnabledJobs) {
      try {
        await taskScheduler.remove();
      } catch (error) {
        try {
          await service.setEnabled(jobId, true);
          await taskScheduler.ensureRegistered(workerCommand);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'Task Scheduler cleanup failed and automatic mirroring could not be restored.',
          );
        }
        throw error;
      }
    }
    return updated;
  });

  ipcMain.handle('jobs:delete', async (event, jobId: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string') {
      throw new TypeError('Job ID must be a string.');
    }
    if (robocopyService?.isRunning(jobId)) {
      throw new Error('Cancel the active copy before removing this job.');
    }
    const service = requireJobService();
    const job = service.list().find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('The mirror job no longer exists.');
    if (job.enabled && service.list().filter((candidate) => candidate.enabled).length === 1) {
      await taskScheduler.remove();
      try {
        service.delete(jobId);
      } catch (error) {
        try {
          await taskScheduler.ensureRegistered(workerCommand);
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The job could not be removed and its scheduled worker could not be restored.',
          );
        }
        throw error;
      }
      return;
    }
    service.delete(jobId);
  });

  ipcMain.handle('jobs:update-exclusions', (event, jobId: unknown, rules: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string' || !isExclusionRules(rules)) {
      throw new TypeError('Invalid job ID or exclusion rules.');
    }
    return requireJobService().updateExclusions(jobId, rules);
  });

  ipcMain.handle('jobs:preview', (event, jobId: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string') throw new TypeError('Job ID must be a string.');
    return requireJobService().preview(jobId);
  });

  ipcMain.handle('jobs:copy-now', async (event, jobId: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string') throw new TypeError('Job ID must be a string.');
    if (!robocopyService) throw new Error('Copy service is not available.');
    return robocopyService.runNow(jobId);
  });

  ipcMain.handle('jobs:cancel-copy', (event, jobId: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string') throw new TypeError('Job ID must be a string.');
    return robocopyService?.cancel(jobId) ?? false;
  });

  ipcMain.handle('folders:select', async (event) => {
    assertMainFrame(event);
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: SANDBOX_ROOT,
      title: 'Select a folder',
    });
    if (result.canceled) return null;
    const selected = result.filePaths[0];
    if (!selected) return null;
    return assertSandboxFolder(selected);
  });

  createWindow();
  void (async () => {
    const hasEnabledJobs = requireJobService().list().some((job) => job.enabled);
    const taskIsRegistered = await taskScheduler.isRegistered();
    if (hasEnabledJobs) {
      const workerIsRunning = taskIsRegistered && await taskScheduler.isRunning();
      if (!taskIsRegistered || !workerIsRunning) {
        await taskScheduler.ensureRegistered(workerCommand);
      }
    } else if (!hasEnabledJobs && taskIsRegistered) {
      await taskScheduler.remove();
    }
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Could not reconcile the automatic-mirroring task:', error);
    dialog.showErrorBox(
      'Automatic mirroring needs attention',
      `The saved automatic-mirroring settings could not be reconciled with Task Scheduler.\n\n${message}`,
    );
  });
});

app.on('before-quit', (event) => {
  if (isBackgroundWorker && !backgroundWorkerStopping) {
    event.preventDefault();
    backgroundWorkerStopping = true;
    backgroundWorkerAbort.abort();
    return;
  }
  if (!quitAfterStopping && robocopyService) {
    event.preventDefault();
    void robocopyService.stopAll().then(
      () => {
        quitAfterStopping = true;
        app.quit();
      },
      (error: unknown) => {
        console.error('Could not stop active copy processes safely:', error);
        dialog.showErrorBox(
          'CodeMirror is still stopping a copy',
          'The app will remain open until the active Robocopy process has stopped.',
        );
      },
    );
    return;
  }
  jobRepository?.close();
  jobRepository = undefined;
  jobService = undefined;
  robocopyService = undefined;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
