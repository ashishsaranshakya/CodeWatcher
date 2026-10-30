import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export interface UserDataPaths {
  rootDirectory: string;
  profileName: string;
  profileDirectory: string;
  databasePath: string;
  previousDataDirectory: string;
}

export function sanitizeProfileName(username: string): string {
  const cleaned = username
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 64);
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'default';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

export function resolveUserDataPaths(
  appDataDirectory: string,
  username: string,
  isPackaged: boolean,
): UserDataPaths {
  const rootDirectory = join(resolve(appDataDirectory), 'CodeMirror');
  const profileName = isPackaged ? sanitizeProfileName(username) : 'dev';
  const profileDirectory = join(rootDirectory, profileName);
  return {
    rootDirectory,
    profileName,
    profileDirectory,
    databasePath: join(profileDirectory, 'codemirror.sqlite'),
    previousDataDirectory: rootDirectory,
  };
}

function copyDirectoryWithoutOverwrite(source: string, destination: string): void {
  if (!existsSync(source)) return;
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'LOCK') continue;
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (existsSync(destinationPath)) {
      if (entry.isDirectory() && lstatSync(destinationPath).isDirectory()) {
        copyDirectoryWithoutOverwrite(sourcePath, destinationPath);
      }
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectoryWithoutOverwrite(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      try {
        copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
  }
}

function preservePreviousConflict(
  sourcePath: string,
  destinationPath: string,
): void {
  const sourceInfo = lstatSync(sourcePath);
  if (sourceInfo.isDirectory()) {
    mkdirSync(destinationPath, { recursive: true });
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      if (entry.name === 'LOCK') continue;
      preservePreviousConflict(
        join(sourcePath, entry.name),
        join(destinationPath, entry.name),
      );
    }
    return;
  }
  if (!sourceInfo.isFile()) return;

  mkdirSync(dirname(destinationPath), { recursive: true });
  if (existsSync(destinationPath)) return;
  try {
    copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

function copyPersistentEntry(
  sourcePath: string,
  destinationPath: string,
  relativePath: string,
  profileDirectory: string,
): void {
  if (existsSync(destinationPath)) {
    const sourceInfo = lstatSync(sourcePath);
    const destinationInfo = lstatSync(destinationPath);
    const conflictPath = join(profileDirectory, 'previous-root-conflicts', relativePath);
    if (sourceInfo.isDirectory() && destinationInfo.isDirectory()) {
      for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
        if (entry.name === 'LOCK') continue;
        copyPersistentEntry(
          join(sourcePath, entry.name),
          join(destinationPath, entry.name),
          join(relativePath, entry.name),
          profileDirectory,
        );
      }
    } else if (
      sourceInfo.isFile() &&
      destinationInfo.isFile() &&
      !readFileSync(sourcePath).equals(readFileSync(destinationPath))
    ) {
      preservePreviousConflict(sourcePath, conflictPath);
    } else if (sourceInfo.isDirectory() && !destinationInfo.isDirectory()) {
      preservePreviousConflict(sourcePath, conflictPath);
    } else if (sourceInfo.isFile() && !destinationInfo.isFile()) {
      preservePreviousConflict(sourcePath, conflictPath);
    }
    return;
  }

  if (lstatSync(sourcePath).isDirectory()) {
    copyDirectoryWithoutOverwrite(sourcePath, destinationPath);
  } else {
    mkdirSync(dirname(destinationPath), { recursive: true });
    try {
      copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

export async function migrateExistingUserData(paths: UserDataPaths): Promise<void> {
  if (resolve(paths.previousDataDirectory) === resolve(paths.profileDirectory)) return;
  mkdirSync(paths.profileDirectory, { recursive: true });

  const ignoredRootEntries = new Set([
    paths.profileName,
    'codemirror.sqlite',
    'codemirror.sqlite-shm',
    'codemirror.sqlite-wal',
    'run-locks',
  ]);
  for (const entry of readdirSync(paths.previousDataDirectory, { withFileTypes: true })) {
    if (ignoredRootEntries.has(entry.name) || entry.name === 'LOCK') continue;
    const sourcePath = join(paths.previousDataDirectory, entry.name);
    const destinationPath = join(paths.profileDirectory, entry.name);
    if (entry.isDirectory()) {
      if (existsSync(join(sourcePath, 'codemirror.sqlite'))) continue;
      copyPersistentEntry(sourcePath, destinationPath, entry.name, paths.profileDirectory);
    } else if (entry.isFile()) {
      copyPersistentEntry(sourcePath, destinationPath, entry.name, paths.profileDirectory);
    }
  }

  const existingDatabasePath = join(paths.previousDataDirectory, 'codemirror.sqlite');
  if (existsSync(existingDatabasePath)) {
    const databaseDestination = existsSync(paths.databasePath)
      ? join(paths.profileDirectory, 'previous-root-conflicts', 'codemirror.sqlite')
      : paths.databasePath;
    if (!existsSync(databaseDestination)) {
      const temporaryDatabasePath = join(
        paths.profileDirectory,
        `.codemirror-migration-${randomUUID()}.sqlite`,
      );
      try {
        const existingDatabase = new DatabaseSync(existingDatabasePath, { readOnly: true });
        try {
          await backup(existingDatabase, temporaryDatabasePath);
        } finally {
          existingDatabase.close();
        }
        try {
          mkdirSync(dirname(databaseDestination), { recursive: true });
          copyFileSync(temporaryDatabasePath, databaseDestination, constants.COPYFILE_EXCL);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      } finally {
        if (existsSync(temporaryDatabasePath)) rmSync(temporaryDatabasePath);
        for (const suffix of ['-wal', '-shm']) {
          const sidecar = `${temporaryDatabasePath}${suffix}`;
          if (existsSync(sidecar)) rmSync(sidecar);
        }
      }
    }
  }

}
