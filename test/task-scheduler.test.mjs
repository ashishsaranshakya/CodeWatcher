import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildTaskSchedulerScript,
  quoteWindowsArgument,
  TaskSchedulerService,
} from '../src/backend/task-scheduler.ts';

describe('Task Scheduler integration', () => {
  it('quotes Windows command-line arguments and protects task ownership', () => {
    assert.equal(quoteWindowsArgument('plain'), '"plain"');
    assert.equal(quoteWindowsArgument('with spaces'), '"with spaces"');
    assert.equal(quoteWindowsArgument('trailing\\'), '"trailing\\\\"');

    const script = buildTaskSchedulerScript('register', 'CodeMirror Background Worker', {
      executable: 'C:\\Program Files\\CodeMirror\\CodeMirror.exe',
      args: ['--background-worker'],
    });
    assert.match(script, /Refusing to modify a task not owned by CodeMirror/);
    assert.match(script, /if \(-not \$existing\)/);
    assert.match(script, /TASK_REGISTERED/);
    assert.match(script, /--background-worker/);
  });

  it('creates and removes a uniquely named disposable task', {
    skip:
      process.platform !== 'win32' ||
      process.env.RUN_CODEMIRROR_SCHEDULER_INTEGRATION !== '1',
  }, async () => {
    const taskName = `CodeMirror-Test-${randomUUID()}`;
    const scheduler = new TaskSchedulerService(taskName);
    try {
      await scheduler.ensureRegistered(
        { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        { triggerAtLogon: false, runImmediately: false },
      );
      assert.equal(await scheduler.isRegistered(), true);
      assert.equal(await scheduler.isRunning(), false);
    } finally {
      await scheduler.remove();
      assert.equal(await scheduler.isRegistered(), false, 'disposable task must be removed');
    }
  });
});
