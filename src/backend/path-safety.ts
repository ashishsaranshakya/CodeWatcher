import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

// TODO: Remove this development-only restriction in the final product after replacing it
// with the production path validation and explicit user approval workflow.
export const SANDBOX_ROOT = 'C:\\Users\\harsh\\Desktop\\CodeWatcher\\sandbox';

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

function normalizeWindowsPath(value: string): string {
  const normalized = path.win32.normalize(value).replace(/\//g, '\\').toLowerCase();
  const root = path.win32.parse(normalized).root.toLowerCase();
  return normalized === root ? root : normalized.replace(/\\+$/, '');
}

function isAtOrBelow(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(parent.endsWith('\\') ? parent : `${parent}\\`);
}

export function pathsOverlap(first: string, second: string): boolean {
  const normalizedFirst = normalizeWindowsPath(first);
  const normalizedSecond = normalizeWindowsPath(second);
  return (
    isAtOrBelow(normalizedFirst, normalizedSecond) ||
    isAtOrBelow(normalizedSecond, normalizedFirst)
  );
}

export function validateMirrorPaths(source: string, destination: string): PathValidationResult {
  const sourcePath = source.trim();
  const destinationPath = destination.trim();

  if (!sourcePath || !destinationPath) {
    return { valid: false, reason: 'Source and destination paths are required.' };
  }
  if (!path.win32.isAbsolute(sourcePath) || !path.win32.isAbsolute(destinationPath)) {
    return { valid: false, reason: 'Source and destination must be absolute Windows paths.' };
  }

  const normalizedSource = normalizeWindowsPath(sourcePath);
  const normalizedDestination = normalizeWindowsPath(destinationPath);

  if (normalizedSource === normalizedDestination) {
    return { valid: false, reason: 'Source and destination must be different folders.' };
  }
  if (isAtOrBelow(normalizedDestination, normalizedSource)) {
    return { valid: false, reason: 'Destination cannot be inside the source folder.' };
  }
  if (isAtOrBelow(normalizedSource, normalizedDestination)) {
    return { valid: false, reason: 'Source cannot be inside the destination folder.' };
  }
  if (/^[a-z]:\\$/i.test(destinationPath)) {
    return { valid: false, reason: 'A drive root cannot be used as a destination.' };
  }
  if (/^(\\\\\?\\|\\\?\?\\)/i.test(sourcePath) || /^(\\\\\?\\|\\\?\?\\)/i.test(destinationPath)) {
    return { valid: false, reason: 'Windows device paths are not supported.' };
  }

  return { valid: true };
}

export function isMirrorPathsValid(source: string, destination: string): boolean {
  return validateMirrorPaths(source, destination).valid;
}

function isStrictlyInside(candidate: string, root: string): boolean {
  const normalizedRoot = path.win32.normalize(root).toLowerCase();
  const normalizedCandidate = path.win32.normalize(candidate).toLowerCase();
  const relative = path.win32.relative(normalizedRoot, normalizedCandidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..\\`) && !path.win32.isAbsolute(relative);
}

export async function assertSandboxFolders(
  source: string,
  destination: string,
  allowMissingDestination = false,
): Promise<{ sourcePath: string; destinationPath: string }> {
  const root = await realpath(SANDBOX_ROOT);
  const resolvedSource = await resolveSandboxCandidate(source, root);
  const resolvedDestination = await resolveSandboxCandidate(destination, root);
  if (!resolvedSource.exists) throw new Error('The source folder must exist.');
  if (!resolvedDestination.exists && !allowMissingDestination) {
    throw new Error('Create the destination folder inside the sandbox before running a copy.');
  }
  const sourceInfo = await stat(resolvedSource.path);
  if (!sourceInfo.isDirectory()) throw new Error('The source must be a folder.');
  if (resolvedDestination.exists) {
    const destinationInfo = await stat(resolvedDestination.path);
    if (!destinationInfo.isDirectory()) throw new Error('The destination must be a folder.');
  }
  if (!validateMirrorPaths(resolvedSource.path, resolvedDestination.path).valid) {
    throw new Error('Resolved source and destination folders overlap.');
  }
  return { sourcePath: resolvedSource.path, destinationPath: resolvedDestination.path };
}

export async function assertSandboxFolder(folder: string): Promise<string> {
  const root = await realpath(SANDBOX_ROOT);
  const resolved = await resolveSandboxCandidate(folder, root);
  if (!resolved.exists) throw new Error('The selected folder does not exist.');
  const info = await stat(resolved.path);
  if (!info.isDirectory()) throw new Error('The selected path is not a folder.');
  return resolved.path;
}

async function resolveSandboxCandidate(
  candidate: string,
  realRoot: string,
): Promise<{ path: string; exists: boolean }> {
  const normalizedCandidate = path.win32.normalize(candidate);
  if (!isStrictlyInside(normalizedCandidate, SANDBOX_ROOT)) {
    throw new Error(`Folders must be inside the development sandbox: ${SANDBOX_ROOT}`);
  }

  let existing = normalizedCandidate;
  const missingSegments: string[] = [];
  while (true) {
    try {
      const realExisting = await realpath(existing);
      if (!isStrictlyInside(realExisting, realRoot)) {
        throw new Error(`Folder resolves outside the development sandbox: ${SANDBOX_ROOT}`);
      }
      if (missingSegments.length > 0) {
        if (!(await stat(realExisting)).isDirectory()) {
          throw new Error('The destination parent must be an existing folder.');
        }
        return { path: path.win32.join(realExisting, ...missingSegments.reverse()), exists: false };
      }
      return { path: realExisting, exists: true };
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        !['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
      ) {
        throw error;
      }
      const parent = path.win32.dirname(existing);
      if (parent === existing) throw error;
      missingSegments.push(path.win32.basename(existing));
      existing = parent;
    }
  }
}
