import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  buildTaskSchedulerScript,
  getProfileTaskName,
  quoteWindowsArgument,
  TaskSchedulerService,
} from '../src/backend/task-scheduler.ts';

describe('Task Scheduler integration', () => {
  it('quotes Windows command-line arguments and protects task ownership', () => {
    assert.equal(quoteWindowsArgument('plain'), '"plain"');
    assert.equal(quoteWindowsArgument('with spaces'), '"with spaces"');
    assert.equal(quoteWindowsArgument('trailing\\'), '"trailing\\\\"');

    const script = buildTaskSchedulerScript('register', getProfileTaskName('dev'), {
      executable: 'C:\\Program Files\\CodeMirror\\CodeMirror.exe',
      args: ['--background-worker', '--profile=dev'],
    }, {}, 'dev');
    assert.match(script, /Refusing to modify a task not owned by CodeMirror/);
    assert.match(script, /if \(-not \$existing\)/);
    assert.match(script, /TASK_REGISTERED/);
    assert.match(script, /--background-worker/);
    assert.match(script, /--profile=dev/);
    assert.match(script, /Managed by CodeMirror profile "dev"/);
    const stopScript = buildTaskSchedulerScript('stop', getProfileTaskName('dev'), undefined, {}, 'dev');
    assert.match(stopScript, /Refusing to modify a task not owned by CodeMirror/);
    assert.ok(stopScript.includes('$existing.Stop(0)'));
  });

  it('creates and removes a uniquely named disposable task', {
    skip:
      process.platform !== 'win32' ||
      process.env.RUN_CODEMIRROR_SCHEDULER_INTEGRATION !== '1',
  }, async () => {
    const profileName = `test-${randomUUID()}`;
    const scheduler = new TaskSchedulerService(profileName);
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
