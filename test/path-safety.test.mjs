import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isMirrorPathsValid, pathsOverlap, validateMirrorPaths } from '../src/backend/path-safety.ts';

describe('validateMirrorPaths', () => {
  it('accepts separate absolute Windows folders', () => {
    assert.deepEqual(validateMirrorPaths('D:\\Code\\project', 'D:\\Backups\\project'), {
      valid: true,
    });
  });

  it('rejects empty and relative paths', () => {
    assert.equal(isMirrorPathsValid('', 'D:\\Backup'), false);
    assert.equal(isMirrorPathsValid('project', 'D:\\Backup'), false);
  });

  it('rejects identical paths regardless of slash and case differences', () => {
    assert.equal(isMirrorPathsValid('D:\\Code\\Project', 'd:/code/project/'), false);
  });

  it('rejects either path nested inside the other', () => {
    assert.equal(isMirrorPathsValid('D:\\Code\\project', 'D:\\Code\\project\\mirror'), false);
    assert.equal(isMirrorPathsValid('D:\\Code\\project\\mirror', 'D:\\Code\\project'), false);
  });

  it('does not mistake a sibling with a shared prefix for a nested path', () => {
    assert.equal(isMirrorPathsValid('D:\\Code\\app', 'D:\\Code\\app-backup'), true);
  });

  it('rejects a drive root as destination and device paths', () => {
    assert.equal(isMirrorPathsValid('D:\\Code\\project', 'D:\\'), false);
    assert.equal(isMirrorPathsValid('\\\\?\\D:\\Code\\project', 'D:\\Backup'), false);
  });

  it('returns a user-readable reason for invalid paths', () => {
    assert.match(
      validateMirrorPaths('D:\\Code\\project', 'D:\\Code\\project\\mirror').reason,
      /inside the source/,
    );
  });

  it('detects parent/child overlap without confusing sibling paths', () => {
    assert.equal(pathsOverlap('D:\\Backup', 'd:/backup/nested'), true);
    assert.equal(pathsOverlap('D:\\Backup', 'D:\\Backup-old'), false);
  });
});
