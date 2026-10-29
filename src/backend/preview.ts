import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExclusionRule, SyncPreview } from '../shared/jobs.ts';
import { isExcluded } from './exclusions.ts';

interface FileMetadata {
  relativePath: string;
  size: number;
  modifiedAtMs: number;
}

interface WalkResult {
  files: Map<string, FileMetadata>;
  warnings: string[];
}

const SAMPLE_LIMIT = 50;
const MAX_DELETIONS = 100;
const MAX_DELETION_PERCENT = 10;

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as NodeJS.ErrnoException).code === 'ENOTDIR')
  );
}

async function scanTree(
  root: string,
  rules: readonly ExclusionRule[],
  allowMissing: boolean,
): Promise<WalkResult> {
  const files = new Map<string, FileMetadata>();
  const warnings: string[] = [];

  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch (error) {
    if (allowMissing && isMissing(error)) return { files, warnings: ['Destination folder does not exist yet.'] };
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error(`${allowMissing ? 'Destination' : 'Source'} must be a real directory, not a link.`);
  }

  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const fullPath = path.join(directory, entry.name);
      const metadata = await lstat(fullPath);
      if (metadata.isSymbolicLink()) {
        warnings.push(`Skipped reparse point: ${relativePath}`);
        continue;
      }
      if (metadata.isDirectory()) {
        if (isExcluded(relativePath, true, rules)) continue;
        await visit(fullPath, relativePath);
        continue;
      }
      if (!metadata.isFile() || isExcluded(relativePath, false, rules)) continue;
      const key = relativePath.toLocaleLowerCase('en-US');
      files.set(key, { relativePath, size: metadata.size, modifiedAtMs: metadata.mtimeMs });
    }
  }

  await visit(root, '');
  return { files, warnings };
}

function addSample(target: string[], relativePath: string): void {
  if (target.length < SAMPLE_LIMIT) target.push(relativePath);
}

export async function createSyncPreview(
  sourcePath: string,
  destinationPath: string,
  exclusions: readonly ExclusionRule[],
): Promise<SyncPreview> {
  const source = await scanTree(sourcePath, exclusions, false);
  const destination = await scanTree(destinationPath, exclusions, true);
  let wouldCopy = 0;
  let wouldUpdate = 0;
  let wouldDelete = 0;
  const sampleCopies: string[] = [];
  const sampleUpdates: string[] = [];
  const sampleDeletions: string[] = [];

  for (const [key, sourceFile] of source.files) {
    const destinationFile = destination.files.get(key);
    if (!destinationFile) {
      wouldCopy += 1;
      addSample(sampleCopies, sourceFile.relativePath);
    } else if (
      sourceFile.size !== destinationFile.size ||
      sourceFile.modifiedAtMs !== destinationFile.modifiedAtMs
    ) {
      wouldUpdate += 1;
      addSample(sampleUpdates, sourceFile.relativePath);
    }
  }

  for (const [key, destinationFile] of destination.files) {
    if (!source.files.has(key)) {
      wouldDelete += 1;
      addSample(sampleDeletions, destinationFile.relativePath);
    }
  }

  const deletionPercentage =
    destination.files.size === 0 ? 0 : (wouldDelete / destination.files.size) * 100;
  const deletionGuardTriggered =
    wouldDelete > MAX_DELETIONS || deletionPercentage > MAX_DELETION_PERCENT;
  const warnings = [...source.warnings, ...destination.warnings];
  warnings.push(
    'Preview compares file names, sizes, and modification times; it does not read file contents or copy/delete files.',
  );
  if (deletionGuardTriggered) {
    warnings.push(
      `Deletion warning: ${wouldDelete} destination-only files (${deletionPercentage.toFixed(1)}%) exceed the preview threshold of ${MAX_DELETIONS} files or ${MAX_DELETION_PERCENT}%. A manual /MIR run can delete them.`,
    );
  }
  if (wouldDelete > SAMPLE_LIMIT) {
    warnings.push(`Only the first ${SAMPLE_LIMIT} planned deletions are shown.`);
  }

  return {
    sourcePath,
    destinationPath,
    sourceFileCount: source.files.size,
    destinationFileCount: destination.files.size,
    wouldCopy,
    wouldUpdate,
    wouldDelete,
    deletionPercentage,
    deletionGuardTriggered,
    warnings,
    sampleCopies,
    sampleUpdates,
    sampleDeletions,
  };
}
