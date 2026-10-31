import { useState } from 'react';
import type { ExclusionRule, ExclusionType, MirrorJob } from '../shared/jobs';
import {
  DEFAULT_EXCLUSIONS,
  SENSITIVE_FILE_PRESET,
  TECHNOLOGY_PRESETS,
  validateExclusionRule,
} from '../backend/exclusions';

const typeLabels: Record<ExclusionType, string> = {
  directory_name: 'Directory name',
  directory_pattern: 'Directory pattern',
  file_pattern: 'File pattern',
  relative_path: 'Relative path',
};

interface Props {
  job: MirrorJob;
  onSaved(jobId: string, rules: ExclusionRule[]): void;
}

export default function ExclusionsEditor({ job, onSaved }: Props) {
  const [rules, setRules] = useState(job.exclusions);
  const [newType, setNewType] = useState<ExclusionType>('relative_path');
  const [newPattern, setNewPattern] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const sensitiveKeys = new Set(
    SENSITIVE_FILE_PRESET.map((rule) => `${rule.type}\0${rule.pattern.toLowerCase()}`),
  );
  const sensitiveActive = SENSITIVE_FILE_PRESET.every((preset) =>
    rules.some(
      (rule) =>
        rule.origin === 'preset' &&
        rule.type === preset.type &&
        rule.pattern.toLowerCase() === preset.pattern.toLowerCase(),
    ),
  );
  const sensitiveRules = rules.filter(
    (rule) => rule.origin === 'preset' && sensitiveKeys.has(`${rule.type}\0${rule.pattern.toLowerCase()}`),
  );
  const technologyRules = rules.filter(
    (rule) =>
      rule.origin === 'preset' &&
      !sensitiveKeys.has(`${rule.type}\0${rule.pattern.toLowerCase()}`),
  );
  const customRules = rules.filter((rule) => rule.origin === 'job');

  async function save(nextRules: ExclusionRule[], successMessage: string): Promise<boolean> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const savedRules = await window.codeMirror.updateExclusions(job.id, nextRules);
      setRules(savedRules);
      onSaved(job.id, savedRules);
      setNotice(successMessage);
      return true;
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save exclusions.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function addPreset(presetRules: readonly ExclusionRule[]): void {
    const seen = new Set(rules.map((rule) => `${rule.type}\0${rule.pattern.toLowerCase()}`));
    const next = [...rules];
    for (const rule of presetRules) {
      const key = `${rule.type}\0${rule.pattern.toLowerCase()}`;
      if (!seen.has(key)) {
        next.push({ ...rule });
        seen.add(key);
      }
    }
    void save(next, 'Preset exclusions saved.');
  }

  function toggleSensitivePreset(): void {
    if (sensitiveActive) {
      const patterns = new Set(SENSITIVE_FILE_PRESET.map((rule) => rule.pattern.toLowerCase()));
      void save(
        rules.filter(
          (rule) =>
            !(
              rule.origin === 'preset' &&
              patterns.has(rule.pattern.toLowerCase()) &&
              rule.type === 'file_pattern'
            ),
        ),
        'Sensitive-file exclusions removed.',
      );
    } else {
      addPreset(SENSITIVE_FILE_PRESET);
    }
  }

  async function addCustomRule(): Promise<void> {
    const pattern = newPattern.trim();
    const validationError = validateExclusionRule({
      type: newType,
      pattern,
      enabled: true,
      origin: 'job',
    });
    if (validationError) {
      setNotice('');
      setError(validationError);
      return;
    }
    const duplicate = rules.some(
      (rule) => rule.type === newType && rule.pattern.toLowerCase() === pattern.toLowerCase(),
    );
    if (duplicate) {
      setNotice('');
      setError('That exclusion already exists for this job.');
      return;
    }
    if (await save([...rules, { type: newType, pattern, enabled: true, origin: 'job' }], 'Custom exclusion added.')) {
      setNewPattern('');
    }
  }

  function renderRuleGroup(title: string, description: string, groupRules: ExclusionRule[]) {
    return (
      <section className="exclusion-rule-group" aria-label={title}>
        <div className="exclusion-group-heading">
          <div>
            <h4>{title}</h4>
            <p>{description}</p>
          </div>
          <span>{groupRules.length}</span>
        </div>
        {groupRules.length === 0 ? (
          <p className="rule-empty">No rules in this group.</p>
        ) : (
          <ul className="rule-list">
            {groupRules.map((rule) => {
              const index = rules.indexOf(rule);
              return (
                <li key={`${rule.origin}:${rule.type}:${rule.pattern}:${index}`}>
                  <span>{typeLabels[rule.type]}</span>
                  <code>{rule.pattern}</code>
                  <span className="rule-origin">{rule.origin === 'preset' ? 'Preset' : 'Custom'}</span>
                  <button
                    type="button"
                    className="text-button destructive"
                    disabled={busy}
                    aria-label={`Remove ${typeLabels[rule.type]} exclusion ${rule.pattern}`}
                    onClick={() =>
                      void save(
                        rules.filter((_, ruleIndex) => ruleIndex !== index),
                        `Exclusion “${rule.pattern}” removed.`,
                      )
                    }
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="exclusions-editor" aria-label={`Exclusions for ${job.name}`} aria-busy={busy}>
      <div className="exclusion-intro">
        <h3>Exclusions</h3>
        <p>
          Matching files and folders are left out of this mirror. Exclusions only remove files from
          the set being mirrored; they cannot restore files that were already deleted or overwritten,
          or override another exclusion. Review the /MIR warning before running a mirror.
        </p>
      </div>

      <details className="inherited-rules">
        <summary>Built-in exclusions · apply to every job ({DEFAULT_EXCLUSIONS.length})</summary>
        <p>These standard development and temporary-file exclusions cannot be removed.</p>
        <ul className="built-in-rule-list">
          {DEFAULT_EXCLUSIONS.map((rule) => (
            <li key={`${rule.type}:${rule.pattern}`}>
              <span>{typeLabels[rule.type]}</span><code>{rule.pattern}</code><span>Built-in</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="exclusion-presets">
        <section className="exclusion-preset-card">
          <h4>Technology presets</h4>
          <p>Add common generated folders for the technology you use.</p>
          <label>
            Choose a preset
            <select
              defaultValue=""
              disabled={busy}
              onChange={(event) => {
                const preset = TECHNOLOGY_PRESETS[event.target.value];
                if (preset) addPreset(preset);
                event.target.value = '';
              }}
            >
              <option value="" disabled>Select a technology…</option>
              <option value="java">Java / Maven / Gradle</option>
              <option value="node">Node.js / npm</option>
              <option value="python">Python environments</option>
              <option value="frontend">React / Vite / frontend builds</option>
            </select>
          </label>
        </section>

        <section className="exclusion-preset-card">
          <h4>Sensitive-file preset</h4>
          <p>Optionally omit common secret and private-key file patterns.</p>
          <label className="sensitive-toggle">
            <input type="checkbox" checked={sensitiveActive} disabled={busy} onChange={toggleSensitivePreset} />
            Exclude likely sensitive files
          </label>
          <span className="form-note">Example and template .env files are exempt from this preset.</span>
        </section>
      </div>

      <div className="exclusion-rule-groups">
        {renderRuleGroup('Technology preset rules', 'Generated files and folders added from a technology preset.', technologyRules)}
        {renderRuleGroup('Sensitive-file rules', 'Patterns that can match credentials or private keys.', sensitiveRules)}
        {renderRuleGroup('Custom rules', 'Rules created specifically for this job.', customRules)}
      </div>

      <section className="custom-rule-builder" aria-labelledby="add-exclusion-title">
        <h4 id="add-exclusion-title">Add a custom exclusion</h4>
        <p>Patterns are relative to the source folder. Parent-directory traversal and absolute paths are not allowed.</p>
        <div className="add-rule-row">
          <label>
            Rule type
            <select value={newType} disabled={busy} onChange={(event) => setNewType(event.target.value as ExclusionType)}>
              {Object.entries(typeLabels).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="pattern-input">
            Pattern
            <input
              value={newPattern}
              onChange={(event) => { setNewPattern(event.target.value); setError(''); setNotice(''); }}
              maxLength={260}
              placeholder="e.g. secrets/**"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addCustomRule();
                }
              }}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void addCustomRule()}>
            {busy ? 'Saving…' : 'Add rule'}
          </button>
        </div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="success-note" role="status">{notice}</p>}
    </section>
  );
}
