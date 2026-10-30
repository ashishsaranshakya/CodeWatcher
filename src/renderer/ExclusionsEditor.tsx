import { useState } from 'react';
import type { ExclusionRule, ExclusionType, MirrorJob } from '../shared/jobs';
import { DEFAULT_EXCLUSIONS, SENSITIVE_FILE_PRESET, TECHNOLOGY_PRESETS } from '../backend/exclusions';

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
  const [busy, setBusy] = useState(false);

  const sensitiveActive = SENSITIVE_FILE_PRESET.every((preset) =>
    rules.some(
      (rule) =>
        rule.origin === 'preset' &&
        rule.type === preset.type &&
        rule.pattern.toLowerCase() === preset.pattern.toLowerCase(),
    ),
  );

  async function save(nextRules: ExclusionRule[]): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const savedRules = await window.codeMirror.updateExclusions(job.id, nextRules);
      setRules(savedRules);
      onSaved(job.id, savedRules);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save exclusions.');
    } finally {
      setBusy(false);
    }
  }

  function addPreset(presetRules: readonly ExclusionRule[]): void {
    const seen = new Set(
      rules.map((rule) => `${rule.type}\0${rule.pattern.toLowerCase()}`),
    );
    const next = [...rules];
    for (const rule of presetRules) {
      const key = `${rule.type}\0${rule.pattern.toLowerCase()}`;
      if (!seen.has(key)) {
        next.push({ ...rule });
        seen.add(key);
      }
    }
    void save(next);
  }

  function toggleSensitivePreset(): void {
    if (sensitiveActive) {
      const sensitivePatterns = new Set(SENSITIVE_FILE_PRESET.map((rule) => rule.pattern.toLowerCase()));
      void save(
        rules.filter(
          (rule) =>
            !(
              rule.origin === 'preset' &&
              sensitivePatterns.has(rule.pattern.toLowerCase()) &&
              rule.type === 'file_pattern'
            ),
        ),
      );
    } else {
      addPreset(SENSITIVE_FILE_PRESET);
    }
  }

  function addCustomRule(): void {
    const pattern = newPattern.trim();
    if (!pattern) {
      setError('Enter an exclusion pattern first.');
      return;
    }
    const duplicate = rules.some(
      (rule) => rule.type === newType && rule.pattern.toLowerCase() === pattern.toLowerCase(),
    );
    if (duplicate) {
      setError('That exclusion already exists for this job.');
      return;
    }
    setNewPattern('');
    void save([...rules, { type: newType, pattern, enabled: true, origin: 'job' }]);
  }

  return (
    <section className="exclusions-editor" aria-label={`Exclusions for ${job.name}`}>
      <p className="form-note">
        Built-in exclusions apply to every job. Added rules only exclude files; there is no
        include/override rule. Matching excluded files are omitted from this mirror.
      </p>
      <details className="inherited-rules">
        <summary>Built-in exclusions ({DEFAULT_EXCLUSIONS.length})</summary>
        <p>{DEFAULT_EXCLUSIONS.map((rule) => rule.pattern).join(', ')}</p>
      </details>

      <div className="preset-row">
        <label>
          Add technology preset
          <select
            defaultValue=""
            disabled={busy}
            onChange={(event) => {
              const preset = TECHNOLOGY_PRESETS[event.target.value];
              if (preset) addPreset(preset);
              event.target.value = '';
            }}
          >
            <option value="" disabled>Select a preset…</option>
            <option value="java">Java / Maven / Gradle</option>
            <option value="node">Node.js / npm</option>
            <option value="python">Python environments</option>
            <option value="frontend">React / Vite / frontend builds</option>
          </select>
        </label>
        <label className="sensitive-toggle">
          <input type="checkbox" checked={sensitiveActive} disabled={busy} onChange={toggleSensitivePreset} />
          Exclude likely sensitive files
        </label>
      </div>
      {sensitiveActive && (
        <p className="warning-note">
          Sensitive-file preset is active. Matching files will not be included in this mirror.
          `.env.example`, `.env.sample`, and `.env.template` are exempt.
        </p>
      )}

      <ul className="rule-list">
        {rules.map((rule, index) => (
          <li key={`${rule.origin}:${rule.type}:${rule.pattern}:${index}`}>
            <span>{typeLabels[rule.type]}</span>
            <code>{rule.pattern}</code>
            <span className="rule-origin">{rule.origin === 'preset' ? 'Preset' : 'Custom'}</span>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              title="Remove this job-specific rule or preset"
              onClick={() => void save(rules.filter((_, ruleIndex) => ruleIndex !== index))}
            >
              Remove
            </button>
          </li>
        ))}
        {rules.length === 0 && <li className="rule-empty">No job-specific rules added.</li>}
      </ul>

      <div className="add-rule-row">
        <label>
          Rule type
          <select value={newType} onChange={(event) => setNewType(event.target.value as ExclusionType)}>
            {Object.entries(typeLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="pattern-input">
          Pattern
          <input
            value={newPattern}
            onChange={(event) => setNewPattern(event.target.value)}
            maxLength={260}
            placeholder="e.g. secrets/**"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustomRule();
              }
            }}
          />
        </label>
        <button type="button" disabled={busy} onClick={addCustomRule}>Add rule</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
