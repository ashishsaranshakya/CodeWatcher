import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  removeUserDataProfile,
  resolveUserDataPaths,
  sanitizeProfileName,
} from '../src/backend/user-data.ts';

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

  it('removes only the installed profile and refuses to remove dev data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codemirror-profile-removal-'));
    const installed = resolveUserDataPaths(root, 'test', true);
    const development = resolveUserDataPaths(root, 'test', false);
    mkdirSync(installed.profileDirectory, { recursive: true });
    mkdirSync(development.profileDirectory, { recursive: true });
    writeFileSync(join(installed.profileDirectory, 'codemirror.sqlite'), 'installed data');
    writeFileSync(join(development.profileDirectory, 'codemirror.sqlite'), 'development data');

    try {
      await removeUserDataProfile(installed);
      assert.equal(existsSync(installed.profileDirectory), false);
      assert.equal(existsSync(development.databasePath), true);
      await assert.rejects(removeUserDataProfile(development), /Refusing to remove/);
      assert.equal(existsSync(development.databasePath), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
