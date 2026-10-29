import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { assertSandboxFolder, assertSandboxFolders, SANDBOX_ROOT } from '../src/backend/path-safety.ts';

describe('development sandbox confinement', () => {
  it('accepts distinct real folders below the sandbox', async () => {
    const root = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-path-test-'));
    try {
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      mkdirSync(source);
      mkdirSync(destination);
      await assertSandboxFolders(source, destination);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a selected folder outside the sandbox', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'codemirror-outside-test-'));
    try {
      await assert.rejects(assertSandboxFolder(outside), /inside the development sandbox/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects a nonexistent destination and never creates it', async () => {
    const root = mkdtempSync(join(SANDBOX_ROOT, '.codemirror-missing-test-'));
    try {
      const source = join(root, 'source');
      const destination = join(root, 'missing-destination');
      mkdirSync(source);
      await assert.rejects(assertSandboxFolders(source, destination), /Create the destination folder/);
      assert.equal(existsSync(destination), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
