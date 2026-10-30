import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUserDataPaths, sanitizeProfileName } from '../src/backend/user-data.ts';

describe('user data profiles', () => {
  it('resolves directly into dev for development and the username when packaged', () => {
    const appData = 'C:\\Users\\test\\AppData\\Roaming';
    const dev = resolveUserDataPaths(appData, 'Test User', false);
    const installed = resolveUserDataPaths(appData, 'Test User', true);

    assert.equal(dev.profileName, 'dev');
    assert.equal(dev.profileDirectory, 'C:\\Users\\test\\AppData\\Roaming\\CodeMirror\\dev');
    assert.equal(dev.databasePath, `${dev.profileDirectory}\\codemirror.sqlite`);
    assert.equal(installed.profileName, 'Test User');
    assert.equal(installed.profileDirectory, 'C:\\Users\\test\\AppData\\Roaming\\CodeMirror\\Test User');
    assert.equal(
      installed.databasePath,
      `${installed.profileDirectory}\\codemirror.sqlite`,
    );
    assert.equal(sanitizeProfileName('CON'), '_CON');
    assert.equal(sanitizeProfileName('  '), 'default');
    assert.equal(sanitizeProfileName('a/b'), 'a_b');
  });
});
