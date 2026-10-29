import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isExcluded, SENSITIVE_FILE_PRESET, validateExclusionRule } from '../src/backend/exclusions.ts';

describe('exclusion matching', () => {
  it('applies inherited directory and generated-file defaults case-insensitively', () => {
    assert.equal(isExcluded('.GIT/config', false), true);
    assert.equal(isExcluded('nested/Node_Modules/package/index.js', false), true);
    assert.equal(isExcluded('src/Cache.PYC', false), true);
    assert.equal(isExcluded('src/App.tsx', false), false);
  });

  it('does not globally exclude ambiguous build output directory names', () => {
    assert.equal(isExcluded('build', true), false);
    assert.equal(isExcluded('dist', true), false);
    assert.equal(isExcluded('target', true), false);
    assert.equal(
      isExcluded('build', true, [
        { type: 'directory_name', pattern: 'build', enabled: true, origin: 'preset' },
      ]),
      true,
    );
  });

  it('supports wildcard directories and relative path globs', () => {
    const rules = [
      { type: 'directory_pattern', pattern: '**/generated-*', enabled: true, origin: 'job' },
      { type: 'relative_path', pattern: 'secrets/**', enabled: true, origin: 'job' },
    ];
    assert.equal(isExcluded('src/generated-assets', true, rules), true);
    assert.equal(isExcluded('src/generated-assets/image.png', false, rules), true);
    assert.equal(isExcluded('secrets/nested/token.txt', false, rules), true);
    assert.equal(isExcluded('src/secrets/nested/token.txt', false, rules), false);
  });

  it('matches file patterns against basenames and keeps case-insensitive Unicode paths', () => {
    const rules = [
      { type: 'file_pattern', pattern: '*.bak', enabled: true, origin: 'job' },
      { type: 'relative_path', pattern: 'Résumé/**', enabled: true, origin: 'job' },
    ];
    assert.equal(isExcluded('résumé/notes.txt', false, rules), true);
    assert.equal(isExcluded('docs/Archive.BAK', false, rules), true);
    assert.equal(isExcluded('docs/Archive.txt', false, rules), false);
  });

  it('excludes sensitive patterns only when explicitly selected and exempts example env files', () => {
    assert.equal(isExcluded('config/.env', false), false);
    assert.equal(isExcluded('config/.env.production', false, SENSITIVE_FILE_PRESET), true);
    assert.equal(isExcluded('config/.env.example', false, SENSITIVE_FILE_PRESET), false);
    assert.equal(isExcluded('certs/private.PEM', false, SENSITIVE_FILE_PRESET), true);
  });

  it('rejects absolute and parent-traversing exclusion patterns', () => {
    assert.match(
      validateExclusionRule({ type: 'relative_path', pattern: '..\\outside', enabled: true, origin: 'job' }),
      /parent directory/,
    );
    assert.match(
      validateExclusionRule({ type: 'relative_path', pattern: 'D:\\secrets', enabled: true, origin: 'job' }),
      /relative paths/,
    );
  });
});
