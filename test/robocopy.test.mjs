import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildRobocopyPlan, classifyRobocopyExitCode, runRobocopyProcess } from '../src/backend/robocopy.ts';
import { SANDBOX_ROOT } from '../src/backend/path-safety.ts';
import { JobService } from '../src/backend/jobs.ts';
import { JobRepository } from '../src/backend/repository.ts';

async function withSandboxFolders(run) {
  const root = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-robo-test-'));
  try {
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('Robocopy mirror behavior', () => {
  it('builds a structured /MIR command with translated exclusions', async () => {
    await withSandboxFolders(async (root) => {
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      mkdirSync(source);
      mkdirSync(destination);
      mkdirSync(join(source, 'node_modules'));
      mkdirSync(join(source, 'private cache'));
      const plan = await buildRobocopyPlan(source, destination, [
        { type: 'directory_pattern', pattern: '**/private*', enabled: true, origin: 'job' },
        { type: 'file_pattern', pattern: '*.secret', enabled: true, origin: 'job' },
      ]);

      assert.equal(plan.executable.toLowerCase().endsWith('\\system32\\robocopy.exe'), true);
      assert.equal(plan.args.includes('/MIR'), true);
      assert.equal(plan.args.includes('/E'), false);
      assert.equal(plan.args.includes('/XD'), true);
      assert.equal(plan.args.includes(join(source, 'node_modules')), true);
      assert.equal(plan.args.includes(join(source, 'private cache')), true);
      assert.equal(plan.args.includes('/XF'), true);
      assert.equal(plan.args.includes('*.secret'), true);
      assert.equal(plan.args.includes('/PURGE'), false);
      assert.equal(plan.args.includes('/MOVE'), false);
    });
  });

  it('rejects exclusion rules that cannot be translated faithfully', async () => {
    await withSandboxFolders(async (root) => {
      const source = join(root, 'source');
      mkdirSync(source);
      await assert.rejects(
        buildRobocopyPlan(source, join(root, 'destination'), [
          { type: 'relative_path', pattern: 'secrets/token.txt', enabled: true, origin: 'job' },
        ]),
        /must target a directory subtree ending in/,
      );
      await assert.rejects(
        buildRobocopyPlan(source, join(root, 'destination'), [
          { type: 'file_pattern', pattern: 'private/*.key', enabled: true, origin: 'job' },
        ]),
        /basename/,
      );
    });
  });

  it('classifies Robocopy codes 0 through 7 as non-failure and 8+ as failure', () => {
    assert.deepEqual(
      Array.from({ length: 8 }, (_, code) => classifyRobocopyExitCode(code)),
      ['success', 'success', 'warning', 'warning', 'warning', 'warning', 'warning', 'warning'],
    );
    assert.equal(classifyRobocopyExitCode(8), 'failure');
    assert.equal(classifyRobocopyExitCode(16), 'failure');
  });

  it('terminates a timed-out child before returning', async () => {
    const result = await runRobocopyProcess(
      { executable: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] },
      1000,
    );
    assert.equal(result.outcome, 'timed_out');
    assert.equal(result.exitCode, null);
    assert.ok(result.durationMs < 10000);
  });

  it('mirrors sandbox fixtures and deletes destination-only files', {
    skip: process.platform !== 'win32',
  }, async () => {
    await withSandboxFolders(async (root) => {
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      mkdirSync(source);
      mkdirSync(destination);
      writeFileSync(join(source, 'hello world.txt'), 'copied by CodeMirror');
      writeFileSync(join(destination, 'remove-me.txt'), 'not present in source');

      const result = await runRobocopyProcess(
        await buildRobocopyPlan(source, destination, []),
        15000,
      );

      assert.notEqual(result.outcome, 'failure');
      assert.equal(readFileSync(join(destination, 'hello world.txt'), 'utf8'), 'copied by CodeMirror');
      assert.equal(existsSync(join(destination, 'remove-me.txt')), false);
    });
  });

  it('runs a manual mirror, overwrites changed files, deletes stale files, and persists the outcome', {
    skip: process.platform !== 'win32',
  }, async () => {
    const root = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-run-test-'));
    const migrations = join(process.cwd(), 'migrations');
    let repository;
    try {
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      mkdirSync(source);
      mkdirSync(destination);
      writeFileSync(join(source, 'shared.txt'), 'new source content');
      writeFileSync(join(destination, 'shared.txt'), 'old destination content');
      for (let index = 0; index < 18; index += 1) {
        const name = `shared-${index}.txt`;
        writeFileSync(join(source, name), 'same content');
        writeFileSync(join(destination, name), 'same content');
      }
      writeFileSync(join(destination, 'stale.txt'), 'remove after preview');
      repository = new JobRepository(join(root, 'state.sqlite'), migrations);
      const job = await new JobService(repository).create({
        name: 'manual-copy',
        sourcePath: source,
        destinationPath: destination,
      });

      const { RobocopyService } = await import('../src/backend/robocopy.ts');
      const result = await new RobocopyService(repository, 15000).runNow(job.id);
      assert.notEqual(result.outcome, 'failure');
      assert.equal(readFileSync(join(destination, 'shared.txt'), 'utf8'), 'new source content');
      assert.equal(existsSync(join(destination, 'stale.txt')), false);

      const { DatabaseSync } = await import('node:sqlite');
      const verificationDb = new DatabaseSync(join(root, 'state.sqlite'), { readOnly: true });
      try {
        const run = verificationDb
          .prepare('SELECT status, exit_code FROM job_runs WHERE run_id = ?')
          .get(result.runId);
        assert.equal(run.status, result.outcome);
        assert.equal(run.exit_code, result.exitCode);
      } finally {
        verificationDb.close();
      }
    } finally {
      repository?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs /MIR despite the informational preview deletion threshold', {
    skip: process.platform !== 'win32',
  }, async () => {
    const root = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-delete-guard-test-'));
    const migrations = join(process.cwd(), 'migrations');
    let repository;
    try {
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      mkdirSync(source);
      mkdirSync(destination);
      writeFileSync(join(source, 'new.txt'), 'would be copied');
      writeFileSync(join(destination, 'stale.txt'), 'would be deleted');
      repository = new JobRepository(join(root, 'state.sqlite'), migrations);
      const job = await new JobService(repository).create({
        name: 'deletion-spike',
        sourcePath: source,
        destinationPath: destination,
      });

      const { RobocopyService } = await import('../src/backend/robocopy.ts');
      const { createSyncPreview } = await import('../src/backend/preview.ts');
      const preview = await createSyncPreview(source, destination, []);
      assert.equal(preview.deletionGuardTriggered, true);
      const result = await new RobocopyService(repository, 15000).runNow(job.id);
      assert.notEqual(result.outcome, 'failure');
      assert.equal(existsSync(join(source, 'new.txt')), true);
      assert.equal(existsSync(join(destination, 'stale.txt')), false);
      assert.equal(readFileSync(join(destination, 'new.txt'), 'utf8'), 'would be copied');
    } finally {
      repository?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
