import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleSquirrelEvent } from '../src/backend/squirrel-lifecycle.ts';

describe('Squirrel lifecycle', () => {
  it('creates a shortcut during install and update without touching user data or jobs', async () => {
    for (const event of ['--squirrel-install', '--squirrel-updated']) {
      const invocations = [];
      let cleanupCalls = 0;
      let refreshCalls = 0;
      await handleSquirrelEvent(
        event,
        'C:\\Users\\test\\AppData\\Local\\CodeMirror\\app-1.0.0\\CodeMirror.exe',
        async () => { cleanupCalls += 1; },
        async (executable, args) => invocations.push({ executable, args }),
        async () => { refreshCalls += 1; },
      );
      assert.deepEqual(invocations, [{
        executable: 'C:\\Users\\test\\AppData\\Local\\CodeMirror\\Update.exe',
        args: ['--createShortcut', 'CodeMirror.exe'],
      }]);
      assert.equal(cleanupCalls, 0);
      assert.equal(refreshCalls, event === '--squirrel-updated' ? 1 : 0);
    }
  });

  it('removes only the owned scheduled task and app shortcut on uninstall', async () => {
    const calls = [];
    await handleSquirrelEvent(
      '--squirrel-uninstall',
      'C:\\Users\\test\\AppData\\Local\\CodeMirror\\app-1.0.0\\CodeMirror.exe',
      async () => { calls.push('remove-owned-task'); },
      async (_executable, args) => calls.push(args),
      async () => {},
      async () => { calls.push('remove-installed-profile'); },
    );
    assert.deepEqual(calls, [
      'remove-owned-task',
      ['--removeShortcut', 'CodeMirror.exe'],
      'remove-installed-profile',
    ]);
  });

  it('does nothing for an obsolete version and propagates cleanup failures', async () => {
    let updateCalled = false;
    await handleSquirrelEvent(
      '--squirrel-obsolete',
      'C:\\CodeMirror\\CodeMirror.exe',
      async () => { throw new Error('must not remove the active task'); },
      async () => { updateCalled = true; },
    );
    assert.equal(updateCalled, false);

    await assert.rejects(
      handleSquirrelEvent(
        '--squirrel-uninstall',
        'C:\\CodeMirror\\CodeMirror.exe',
        async () => { throw new Error('scheduler unavailable'); },
        async () => { updateCalled = true; },
      ),
      /scheduler unavailable/,
    );
    assert.equal(updateCalled, false);
  });
});
