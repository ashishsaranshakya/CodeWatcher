import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { JobService } from './backend/jobs';
import { assertSandboxFolder, SANDBOX_ROOT, validateMirrorPaths } from './backend/path-safety';
import { JobRepository } from './backend/repository';
import { RobocopyService } from './backend/robocopy';
import type { CreateJobInput, ExclusionRule } from './shared/jobs';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let jobService: JobService | undefined;
let jobRepository: JobRepository | undefined;
let robocopyService: RobocopyService | undefined;
let quitAfterStopping = false;

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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  const migrationsDirectory = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(app.getAppPath(), 'migrations');
  jobRepository = new JobRepository(join(app.getPath('userData'), 'codemirror.sqlite'), migrationsDirectory);
  jobService = new JobService(jobRepository);
  robocopyService = new RobocopyService(jobRepository);

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

  ipcMain.handle('jobs:create', (event, input: unknown) => {
    assertMainFrame(event);
    if (!isCreateJobInput(input)) {
      throw new TypeError('Invalid mirror job configuration.');
    }
    return requireJobService().create(input);
  });

  ipcMain.handle('jobs:delete', (event, jobId: unknown) => {
    assertMainFrame(event);
    if (typeof jobId !== 'string') {
      throw new TypeError('Job ID must be a string.');
    }
    if (robocopyService?.isRunning(jobId)) {
      throw new Error('Cancel the active copy before removing this job.');
    }
    requireJobService().delete(jobId);
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
});

app.on('before-quit', (event) => {
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
