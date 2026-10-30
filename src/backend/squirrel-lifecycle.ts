import { spawn } from 'node:child_process';
import path from 'node:path';

export type SquirrelEvent =
  | '--squirrel-install'
  | '--squirrel-updated'
  | '--squirrel-uninstall'
  | '--squirrel-obsolete';

export interface SquirrelUpdateRunner {
  (updateExecutable: string, args: string[]): Promise<void>;
}

const UPDATE_TIMEOUT_MS = 15_000;

function runUpdateExecutable(
  updateExecutable: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(updateExecutable, args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Squirrel Update.exe exceeded its 15-second limit.'));
    }, UPDATE_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Squirrel Update.exe failed with exit code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

export async function handleSquirrelEvent(
  event: SquirrelEvent,
  executablePath: string,
  removeOwnedTask: () => Promise<void>,
  updateRunner: SquirrelUpdateRunner = runUpdateExecutable,
  updateWorkerTask: () => Promise<void> = async () => {},
): Promise<void> {
  if (event === '--squirrel-obsolete') return;

  const appName = path.basename(executablePath);
  const updateExecutable = path.resolve(path.dirname(executablePath), '..', 'Update.exe');
  if (event === '--squirrel-install') {
    await updateRunner(updateExecutable, ['--createShortcut', appName]);
    return;
  }
  if (event === '--squirrel-updated') {
    await updateRunner(updateExecutable, ['--createShortcut', appName]);
    await updateWorkerTask();
    return;
  }

  await removeOwnedTask();
  await updateRunner(updateExecutable, ['--removeShortcut', appName]);
}
