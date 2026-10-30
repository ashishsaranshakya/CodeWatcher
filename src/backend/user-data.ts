import { rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export interface UserDataPaths {
  rootDirectory: string;
  profileName: string;
  profileDirectory: string;
  databasePath: string;
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
  };
}

export async function removeUserDataProfile(paths: UserDataPaths): Promise<void> {
  const rootDirectory = resolve(paths.rootDirectory);
  const profileDirectory = resolve(paths.profileDirectory);
  if (
    paths.profileName === 'dev' ||
    dirname(profileDirectory) !== rootDirectory ||
    basename(profileDirectory) !== paths.profileName
  ) {
    throw new Error('Refusing to remove a profile outside its expected CodeMirror directory.');
  }
  await rm(profileDirectory, { recursive: true, force: true });
}
