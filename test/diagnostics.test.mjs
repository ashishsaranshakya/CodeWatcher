import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildDiagnosticBundle,
  DiagnosticLogger,
  readDiagnosticLogs,
  redactDiagnosticText,
} from '../src/backend/diagnostics.ts';
import { SANDBOX_ROOT } from '../src/backend/path-safety.ts';

describe('diagnostic logging and export', () => {
  it('redacts local paths and sensitive structured fields from log entries', () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-diagnostics-test-'));
    try {
      const logger = new DiagnosticLogger(directory);
      logger.error('copy_failed', {
        message: 'Cannot access C:\\Users\\harsh\\Documents\\private.txt.',
        destinationPath: 'C:\\Users\\harsh\\Desktop\\CodeWatcher\\sandbox\\dest',
      });

      const logPath = join(directory, 'app.jsonl');
      const saved = readFileSync(logPath, 'utf8');
      assert.doesNotMatch(saved, /C:\\Users\\harsh/);
      const [entry] = readDiagnosticLogs(directory);
      assert.equal(entry.event, 'copy_failed');
      assert.equal(entry.destinationPath, '[REDACTED]');
      assert.equal(entry.message, 'Cannot access [REDACTED_PATH]');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rotates diagnostic logs to a bounded number of backups', () => {
    const directory = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-log-rotation-test-'));
    try {
      const logger = new DiagnosticLogger(directory, { maxBytes: 1024, backupCount: 2 });
      for (let index = 0; index < 12; index += 1) {
        logger.info('test_record', { index, padding: 'x'.repeat(250) });
      }

      const files = readdirSync(directory).sort();
      assert.deepEqual(files, ['app.jsonl', 'app.jsonl.1', 'app.jsonl.2']);
      assert.ok(readDiagnosticLogs(directory).length <= 9);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exports diagnostic summaries without job names, identifiers, or local paths', () => {
    const bundle = buildDiagnosticBundle({
      version: '1.0.0',
      electronVersion: '38.0.0',
      platform: 'win32',
      architecture: 'x64',
      configuredJobs: 1,
      enabledJobs: 0,
      runs: [{
        runId: 'private-run-id',
        jobId: 'private-job-id',
        jobName: 'Private project name',
        trigger: 'manual',
        outcome: 'failure',
        startedAt: '2026-10-29T00:00:00.000Z',
        finishedAt: '2026-10-29T00:00:01.000Z',
        exitCode: 8,
        durationMs: 1000,
        summary: 'Cannot access C:\\Users\\harsh\\Documents\\private.txt',
        outputTruncated: false,
      }],
      logs: [{
        timestamp: '2026-10-29T00:00:00.000Z',
        level: 'info',
        event: 'test',
        jobId: 'private-job-id',
        runId: 'private-run-id',
        sourcePath: 'C:\\Users\\harsh\\private',
      }],
    });
    const serialized = JSON.stringify(bundle);

    assert.match(serialized, /Job 1/);
    assert.doesNotMatch(serialized, /private-run-id|private-job-id|Private project name|C:\\Users\\harsh/);
    assert.match(serialized, /\[REDACTED_PATH\]/);
    assert.equal(bundle.mirror.configuredJobs, 1);
    assert.equal(bundle.recentRuns[0].job, 'Job 1');
  });

  it('redacts Windows drive and network paths in text', () => {
    assert.equal(
      redactDiagnosticText('Failed at C:\\private\\file.txt and \\\\server\\share\\secret'),
      'Failed at [REDACTED_PATH]',
    );
    assert.equal(
      redactDiagnosticText('Network failure at \\\\server\\share\\secret'),
      'Network failure at [REDACTED_PATH]',
    );
  });
});
