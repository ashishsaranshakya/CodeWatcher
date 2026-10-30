import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import {
  migrateExistingUserData,
  resolveUserDataPaths,
  sanitizeProfileName,
} from '../src/backend/user-data.ts';

describe('user data profiles', () => {
  it('selects separate development and username profiles with safe names', () => {
    const appData = 'C:\\Users\\test\\AppData\\Roaming';
    const dev = resolveUserDataPaths(appData, 'Test User', false);
    const installed = resolveUserDataPaths(appData, 'Test User', true);
    assert.equal(dev.profileName, 'dev');
    assert.match(dev.profileDirectory, /CodeMirror\\dev$/);
    assert.equal(installed.profileName, 'Test User');
    assert.match(installed.profileDirectory, /CodeMirror\\Test User$/);
    assert.equal(sanitizeProfileName('CON'), '_CON');
    assert.equal(sanitizeProfileName('  '), 'default');
    assert.equal(sanitizeProfileName('a/b'), 'a_b');
  });

  it('copies existing Electron state and a consistent WAL database without overwriting profile data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codemirror-profile-migration-'));
    const paths = resolveUserDataPaths(root, 'test-user', false);
    mkdirSync(paths.previousDataDirectory, { recursive: true });
    const previousDatabasePath = join(paths.previousDataDirectory, 'codemirror.sqlite');
    const previousLogs = join(paths.previousDataDirectory, 'logs');
    mkdirSync(previousLogs);
    writeFileSync(join(previousLogs, 'previous.jsonl'), 'previous-log\n');
    mkdirSync(join(paths.previousDataDirectory, 'GPUCache'));
    writeFileSync(join(paths.previousDataDirectory, 'GPUCache', 'data_0'), 'cache-data');
    mkdirSync(join(paths.profileDirectory, 'GPUCache'), { recursive: true });
    writeFileSync(join(paths.profileDirectory, 'GPUCache', 'data_0'), 'new-profile-cache');
    mkdirSync(join(paths.previousDataDirectory, 'run-locks'));
    writeFileSync(join(paths.previousDataDirectory, 'run-locks', 'stale-lock'), 'do-not-copy');
    writeFileSync(join(paths.previousDataDirectory, 'LOCK'), 'do-not-copy');

    const source = new DatabaseSync(previousDatabasePath);
    try {
      source.exec('PRAGMA journal_mode = WAL; CREATE TABLE preserved (value TEXT NOT NULL);');
      source.prepare('INSERT INTO preserved (value) VALUES (?)').run('from-previous-wal');
      mkdirSync(paths.profileDirectory, { recursive: true });
      mkdirSync(join(paths.profileDirectory, 'logs'), { recursive: true });
      writeFileSync(join(paths.profileDirectory, 'logs', 'existing.jsonl'), 'profile-log\n');

      await migrateExistingUserData(paths);
      const migrated = new DatabaseSync(paths.databasePath, { readOnly: true });
      try {
        assert.equal(
          migrated.prepare('SELECT value FROM preserved').get().value,
          'from-previous-wal',
        );
      } finally {
        migrated.close();
      }

      await migrateExistingUserData(paths);
      assert.equal(readFileSync(join(paths.profileDirectory, 'logs', 'previous.jsonl'), 'utf8'), 'previous-log\n');
      assert.equal(readFileSync(join(paths.profileDirectory, 'logs', 'existing.jsonl'), 'utf8'), 'profile-log\n');
      assert.equal(readFileSync(join(previousLogs, 'previous.jsonl'), 'utf8'), 'previous-log\n');
      assert.equal(readFileSync(join(paths.profileDirectory, 'GPUCache', 'data_0'), 'utf8'), 'new-profile-cache');
      assert.equal(
        readFileSync(join(paths.profileDirectory, 'previous-root-conflicts', 'GPUCache', 'data_0'), 'utf8'),
        'cache-data',
      );
      assert.equal(readFileSync(join(paths.previousDataDirectory, 'GPUCache', 'data_0'), 'utf8'), 'cache-data');
      assert.equal(existsSync(join(paths.profileDirectory, 'run-locks')), false);
      assert.equal(existsSync(join(paths.profileDirectory, 'LOCK')), false);
      assert.equal(readdirSync(join(paths.previousDataDirectory, 'run-locks')).length, 1);
      assert.equal(
        readdirSync(paths.profileDirectory).some((entry) => entry.startsWith('.codemirror-migration-')),
        false,
        'temporary migration database files must be removed',
      );
      const previousDatabaseCopy = new DatabaseSync(
        join(paths.profileDirectory, 'previous-root-conflicts', 'codemirror.sqlite'),
        { readOnly: true },
      );
      try {
        assert.equal(
          previousDatabaseCopy.prepare('SELECT value FROM preserved').get().value,
          'from-previous-wal',
        );
      } finally {
        previousDatabaseCopy.close();
      }
    } finally {
      source.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not replace a database already created for the selected profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codemirror-existing-profile-'));
    const paths = resolveUserDataPaths(root, 'test-user', false);
    mkdirSync(paths.previousDataDirectory, { recursive: true });
    mkdirSync(paths.profileDirectory, { recursive: true });
    const previousDatabase = new DatabaseSync(join(paths.previousDataDirectory, 'codemirror.sqlite'));
    const profile = new DatabaseSync(paths.databasePath);
    try {
      previousDatabase.exec('CREATE TABLE state (value TEXT NOT NULL);');
      previousDatabase.prepare('INSERT INTO state (value) VALUES (?)').run('previous');
      profile.exec('CREATE TABLE state (value TEXT NOT NULL);');
      profile.prepare('INSERT INTO state (value) VALUES (?)').run('profile');
      await migrateExistingUserData(paths);
      assert.equal(profile.prepare('SELECT value FROM state').get().value, 'profile');
    } finally {
      previousDatabase.close();
      profile.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
