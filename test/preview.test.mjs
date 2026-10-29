import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createSyncPreview } from '../src/backend/preview.ts';

async function withFolders(run) {
  const root = mkdtempSync(join(tmpdir(), 'codemirror-preview-test-'));
  const source = join(root, 'source');
  const destination = join(root, 'destination');
  mkdirSync(source);
  try {
    await run({ root, source, destination });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('read-only synchronization preview', () => {
  it('counts new, changed, unchanged, and potential deletion files without modifying either tree', async () => {
    await withFolders(async ({ source, destination }) => {
      mkdirSync(destination);
      writeFileSync(join(source, 'same.txt'), 'same');
      writeFileSync(join(destination, 'same.txt'), 'same');
      const timestamp = new Date('2024-01-01T00:00:00.000Z');
      utimesSync(join(source, 'same.txt'), timestamp, timestamp);
      utimesSync(join(destination, 'same.txt'), timestamp, timestamp);
      writeFileSync(join(source, 'update.txt'), 'new content');
      writeFileSync(join(destination, 'update.txt'), 'old');
      writeFileSync(join(source, 'new.txt'), 'new file');
      writeFileSync(join(destination, 'removed.txt'), 'destination-only');
      mkdirSync(join(source, 'node_modules'));
      writeFileSync(join(source, 'node_modules', 'excluded.js'), 'excluded');

      const preview = await createSyncPreview(source, destination, []);

      assert.equal(preview.sourceFileCount, 3);
      assert.equal(preview.destinationFileCount, 3);
      assert.equal(preview.wouldCopy, 1);
      assert.equal(preview.wouldUpdate, 1);
      assert.equal(preview.wouldDelete, 1);
      assert.equal(preview.deletionGuardTriggered, true);
      assert.deepEqual(statSync(join(destination, 'removed.txt')).isFile(), true);
      assert.equal(statSync(join(source, 'node_modules', 'excluded.js')).isFile(), true);
    });
  });

  it('reports an absent destination as an empty mirror target and plans copies only', async () => {
    await withFolders(async ({ source, destination }) => {
      writeFileSync(join(source, 'one.txt'), 'one');
      const preview = await createSyncPreview(source, destination, []);
      assert.equal(preview.wouldCopy, 1);
      assert.equal(preview.wouldUpdate, 0);
      assert.equal(preview.wouldDelete, 0);
      assert.equal(preview.deletionGuardTriggered, false);
      assert.equal(preview.warnings.some((warning) => warning.includes('does not exist yet')), true);
      assert.equal(statSync(source).isDirectory(), true);
    });
  });

  it('fails closed when the source is missing', async () => {
    await withFolders(async ({ root, destination }) => {
      await assert.rejects(createSyncPreview(join(root, 'missing'), destination, []), /ENOENT/);
    });
  });

  it('warns and omits sensitive exclusions from the preview only when the preset is active', async () => {
    await withFolders(async ({ source, destination }) => {
      writeFileSync(join(source, '.env.production'), 'not read by preview');
      writeFileSync(join(source, '.env.example'), 'example');
      const { SENSITIVE_FILE_PRESET } = await import('../src/backend/exclusions.ts');
      const preview = await createSyncPreview(source, destination, SENSITIVE_FILE_PRESET);
      assert.equal(preview.sourceFileCount, 1);
      assert.deepEqual(preview.sampleCopies, ['.env.example']);
    });
  });
});
