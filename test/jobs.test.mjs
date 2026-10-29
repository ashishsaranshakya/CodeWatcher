import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { JobService } from '../src/backend/jobs.ts';
import { JobRepository } from '../src/backend/repository.ts';
import { SANDBOX_ROOT } from '../src/backend/path-safety.ts';
import { tmpdir } from 'node:os';

const migrationsDirectory = join(process.cwd(), 'migrations');

async function withRepository(run) {
  const testDirectory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-jobs-test-'));
  let repository;
  try {
    repository = new JobRepository(join(testDirectory, 'test.sqlite'), migrationsDirectory);
    await run(repository, testDirectory);
  } finally {
    repository?.close();
    rmSync(testDirectory, { recursive: true, force: true });
  }
}

describe('job configuration persistence', () => {
  it('migrates the database and persists jobs across repository restarts', async () => {
    const testDirectory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-reopen-test-'));
    const databasePath = join(testDirectory, 'test.sqlite');
    let repository;
    try {
      repository = new JobRepository(databasePath, migrationsDirectory);
      const source = join(testDirectory, 'source');
      mkdirSync(source);
      const service = new JobService(repository);
      const created = await service.create({
        name: 'project',
        sourcePath: source,
        destinationPath: join(testDirectory, 'backup'),
      });
      assert.equal(created.enabled, false);
      repository.close();
      repository = undefined;
      repository = new JobRepository(databasePath, migrationsDirectory);
      assert.equal(repository.list()[0].id, created.id);
    } finally {
      repository?.close();
      rmSync(testDirectory, { recursive: true, force: true });
    }
  });

  it('persists automatic-mirroring enablement only for valid sandbox folders', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      const destination = join(testDirectory, 'backup');
      mkdirSync(source);
      mkdirSync(destination);
      const service = new JobService(repository);
      const created = await service.create({
        name: 'automatic',
        sourcePath: source,
        destinationPath: destination,
      });

      const enabled = await service.setEnabled(created.id, true);
      assert.equal(enabled.enabled, true);
      assert.equal(repository.list()[0].enabled, true);

      const disabled = await service.setEnabled(created.id, false);
      assert.equal(disabled.enabled, false);
      assert.equal(repository.list()[0].enabled, false);
    });
  });

  it('records trigger-aware run history, redacts local paths, and retains only 1000 runs', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      mkdirSync(source);
      const job = await new JobService(repository).create({
        name: 'History test',
        sourcePath: source,
        destinationPath: join(testDirectory, 'destination'),
      });

      for (let index = 0; index < 1005; index += 1) {
        const startedAt = new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString();
        repository.recordRun({
          runId: `history-${index}`,
          jobId: job.id,
          trigger: 'watcher',
          outcome: 'success',
          startedAt,
          finishedAt: new Date(Date.parse(startedAt) + 10).toISOString(),
          exitCode: 1,
          durationMs: 10,
          summary: `Mirrored ${source}`,
          outputTruncated: false,
        });
      }

      const history = repository.listRunHistory(1000);
      assert.equal(history.length, 1000);
      assert.equal(history[0].runId, 'history-1004');
      assert.equal(repository.listRunHistory(1)[0].trigger, 'watcher');
      assert.match(repository.listRunHistory(1)[0].summary, /\[REDACTED_PATH\]/);
      assert.equal(repository.listRunHistory(5000).length, 1000);
    });
  });

  it('rejects case-insensitive duplicate job names', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      mkdirSync(source);
      const service = new JobService(repository);
      await service.create({ name: 'Project', sourcePath: source, destinationPath: join(testDirectory, 'backup-a') });

      await assert.rejects(
        service.create({ name: 'project', sourcePath: source, destinationPath: join(testDirectory, 'backup-b') }),
        /name already exists/,
      );
    });
  });

  it('rejects jobs whose destination conflicts with another job source or destination', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      mkdirSync(source);
      const service = new JobService(repository);
      await service.create({ name: 'first', sourcePath: source, destinationPath: join(testDirectory, 'backup') });

      await assert.rejects(
        service.create({
          name: 'second',
          sourcePath: source,
          destinationPath: join(testDirectory, 'backup', 'nested'),
        }),
        /overlaps a folder/,
      );
    });
  });

  it('serializes conflicting job creation inside a SQLite write transaction', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      mkdirSync(source);
      const service = new JobService(repository);
      const results = await Promise.allSettled([
        service.create({ name: 'first', sourcePath: source, destinationPath: join(testDirectory, 'backup') }),
        service.create({ name: 'second', sourcePath: source, destinationPath: join(testDirectory, 'backup', 'nested') }),
      ]);

      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal(repository.list().length, 1);
    });
  });

  it('rejects a missing source and leaves the job list unchanged', async () => {
    await withRepository(async (repository, testDirectory) => {
      const service = new JobService(repository);
      await assert.rejects(
        service.create({
          name: 'missing',
          sourcePath: join(testDirectory, 'missing'),
          destinationPath: join(testDirectory, 'backup'),
        }),
        /source folder must exist/,
      );
      assert.deepEqual(repository.list(), []);
    });
  });

  it('rejects a source folder outside the hard-coded development sandbox', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codemirror-outside-source-'));
    try {
      await withRepository(async (repository, testDirectory) => {
        const destination = join(testDirectory, 'destination');
        await assert.rejects(
          new JobService(repository).create({
            name: 'outside-source',
            sourcePath: outside,
            destinationPath: destination,
          }),
          /inside the development sandbox/,
        );
        assert.deepEqual(repository.list(), []);
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('deletes only configuration and never touches the source or destination folders', async () => {
    await withRepository(async (repository, testDirectory) => {
      const source = join(testDirectory, 'source');
      const destination = join(testDirectory, 'backup');
      mkdirSync(source);
      mkdirSync(destination);
      const service = new JobService(repository);
      const job = await service.create({ name: 'project', sourcePath: source, destinationPath: destination });

      service.delete(job.id);

      assert.deepEqual(repository.list(), []);
      assert.equal(statSync(source).isDirectory(), true);
      assert.equal(statSync(destination).isDirectory(), true);
    });
  });
});
