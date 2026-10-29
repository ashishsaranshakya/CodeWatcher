import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { assertSandboxFolders, pathsOverlap, validateMirrorPaths } from './path-safety.ts';
import type { JobRepository } from './repository.ts';
import type { CreateJobInput, ExclusionRule, MirrorJob } from '../shared/jobs.ts';
import { validateExclusionRule } from './exclusions.ts';
import { createSyncPreview } from './preview.ts';

export class JobService {
  private readonly repository: JobRepository;

  constructor(repository: JobRepository) {
    this.repository = repository;
  }

  list(): MirrorJob[] {
    return this.repository.list();
  }

  async setEnabled(jobId: string, enabled: boolean): Promise<MirrorJob> {
    const job = this.repository.list().find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('The mirror job no longer exists.');
    if (enabled) {
      await assertSandboxFolders(job.sourcePath, job.destinationPath);
    }
    if (!this.repository.setEnabled(jobId, enabled)) {
      throw new Error('The mirror job could not be updated.');
    }
    return { ...job, enabled, updatedAt: new Date().toISOString() };
  }

  updateExclusions(jobId: string, rules: ExclusionRule[]): ExclusionRule[] {
    const job = this.repository.list().find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('The mirror job no longer exists.');
    if (rules.length > 500) throw new Error('A job can have at most 500 custom exclusions.');
    const seen = new Set<string>();
    for (const rule of rules) {
      if (rule.origin !== 'job' && rule.origin !== 'preset') {
        throw new Error('Inherited default exclusion rules cannot be edited.');
      }
      const validationError = validateExclusionRule(rule);
      if (validationError) throw new Error(validationError);
      const key = `${rule.type}\0${rule.pattern.trim().toLocaleLowerCase('en-US')}`;
      if (seen.has(key)) throw new Error('Duplicate exclusion rules are not allowed.');
      seen.add(key);
    }
    return this.repository.replaceExclusions(jobId, rules);
  }

  async preview(jobId: string) {
    const job = this.repository.list().find((candidate) => candidate.id === jobId);
    if (!job) throw new Error('The mirror job no longer exists.');
    const pathValidation = validateMirrorPaths(job.sourcePath, job.destinationPath);
    if (!pathValidation.valid) throw new Error(pathValidation.reason);
    const safePaths = await assertSandboxFolders(job.sourcePath, job.destinationPath);
    return createSyncPreview(safePaths.sourcePath, safePaths.destinationPath, job.exclusions);
  }

  async create(input: CreateJobInput): Promise<MirrorJob> {
    const name = input.name.trim();
    if (!name || name.length > 100) {
      throw new Error('Job name must contain between 1 and 100 characters.');
    }

    const source = input.sourcePath.trim();
    const destination = input.destinationPath.trim();
    const pathValidation = validateMirrorPaths(source, destination);
    if (!pathValidation.valid) {
      throw new Error(pathValidation.reason);
    }

    const sourceStat = await stat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (!sourceStat?.isDirectory()) {
      throw new Error('The source folder must exist and be accessible.');
    }

    const destinationStat = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      throw error;
    });
    if (destinationStat && !destinationStat.isDirectory()) {
      throw new Error('The destination path exists but is not a folder.');
    }
    const safePaths = await assertSandboxFolders(source, destination, true);

    const existingJobs = this.repository.list();
    if (existingJobs.some((job) => job.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
      throw new Error('A job with this name already exists.');
    }
    if (
      existingJobs.some(
        (job) =>
          pathsOverlap(destination, job.destinationPath) ||
          pathsOverlap(destination, job.sourcePath) ||
          pathsOverlap(source, job.destinationPath),
      )
    ) {
      throw new Error('This source or destination overlaps a folder used by another job.');
    }

    const timestamp = new Date().toISOString();
    const job: MirrorJob = {
      id: randomUUID(),
      name,
      sourcePath: safePaths.sourcePath,
      destinationPath: safePaths.destinationPath,
      enabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      exclusions: [],
    };

    return this.repository.create(job);
  }

  delete(jobId: string): void {
    if (!this.repository.delete(jobId)) {
      throw new Error('The mirror job no longer exists.');
    }
  }
}
