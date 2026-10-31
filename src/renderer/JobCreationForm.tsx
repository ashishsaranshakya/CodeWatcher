import { useState } from 'react';
import type { FormEvent, Dispatch, SetStateAction } from 'react';
import type { MirrorJob } from '../shared/jobs';

type DraftField = 'name' | 'sourcePath' | 'destinationPath';
type DraftErrors = Partial<Record<DraftField, string>>;

interface Props {
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  sourcePath: string;
  setSourcePath: Dispatch<SetStateAction<string>>;
  destinationPath: string;
  setDestinationPath: Dispatch<SetStateAction<string>>;
  restrictToSandbox: boolean | null;
  onCreated(job: MirrorJob): void;
  onCancel(): void;
}

function isPairValidationError(reason: string): boolean {
  return /different folders|cannot be inside|overlap/i.test(reason);
}

export default function JobCreationForm({
  name,
  setName,
  sourcePath,
  setSourcePath,
  destinationPath,
  setDestinationPath,
  restrictToSandbox,
  onCreated,
  onCancel,
}: Props) {
  const [fieldErrors, setFieldErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  function clearFieldError(field: DraftField): void {
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError('');
  }

  async function chooseFolder(field: 'sourcePath' | 'destinationPath'): Promise<void> {
    setFormError('');
    try {
      const selected = await window.codeMirror.selectFolder();
      if (selected) {
        if (field === 'sourcePath') setSourcePath(selected);
        else setDestinationPath(selected);
        clearFieldError(field);
      }
    } catch (selectionError: unknown) {
      setFieldErrors((current) => ({
        ...current,
        [field]: selectionError instanceof Error ? selectionError.message : 'Folder selection failed.',
      }));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError('');
    const errors: DraftErrors = {};
    if (!name.trim()) errors.name = 'Enter a name for this job.';
    else if (name.trim().length > 100) errors.name = 'Job names must be 100 characters or fewer.';
    if (!sourcePath.trim()) errors.sourcePath = 'Choose or enter a source folder.';
    if (!destinationPath.trim()) errors.destinationPath = 'Choose or enter a destination folder.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const pathResult = await window.codeMirror.validatePaths(sourcePath, destinationPath);
      if (!pathResult.valid) {
        const reason = pathResult.reason ?? 'Check the source and destination folders.';
        if (isPairValidationError(reason)) {
          setFormError(reason);
        } else if (/source/i.test(reason) && /destination/i.test(reason)) {
          setFieldErrors({ sourcePath: reason, destinationPath: reason });
        } else if (/source/i.test(reason)) {
          setFieldErrors({ sourcePath: reason });
        } else if (/destination/i.test(reason)) {
          setFieldErrors({ destinationPath: reason });
        } else {
          setFormError(reason);
        }
        return;
      }

      const job = await window.codeMirror.createJob({ name: name.trim(), sourcePath, destinationPath });
      onCreated(job);
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save this job.';
      if (/job name|job with this name/i.test(message)) {
        setFieldErrors({ name: message });
      } else if (/source folder|source must|source path/i.test(message)) {
        setFieldErrors({ sourcePath: message });
      } else if (/destination/i.test(message)) {
        setFieldErrors({ destinationPath: message });
      } else if (/sandbox/i.test(message)) {
        setFieldErrors({ sourcePath: message, destinationPath: message });
      } else {
        setFormError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const sourceDescription =
    restrictToSandbox === true
      ? 'In development, choose a source inside the CodeWatcher sandbox.'
      : 'Choose an existing folder to mirror from.';
  const destinationDescription =
    restrictToSandbox === true
      ? 'In development, the destination must also be inside the CodeWatcher sandbox.'
      : 'Choose an existing folder, or enter a new folder path under an existing parent.';

  return (
    <section className="page-section" aria-labelledby="job-create-title">
      <div className="section-heading">
        <div>
          <a className="back-link" href="#/jobs" onClick={onCancel}>← All mirror jobs</a>
          <span className="eyebrow">NEW MIRROR JOB</span>
          <h1 className="page-title" id="job-create-title">Set up a mirror</h1>
          <p>Choose a source and destination. Review the summary before saving.</p>
        </div>
      </div>

      <form className="job-form job-creation-form" onSubmit={(event) => void submit(event)} aria-busy={busy} noValidate>
        <section className="creation-step" aria-labelledby="job-name-heading">
          <span className="step-number" aria-hidden="true">1</span>
          <div className="creation-step-content">
            <h2 id="job-name-heading">Name this job</h2>
            <label htmlFor="job-name">Job name</label>
            <input
              id="job-name"
              value={name}
              onChange={(event) => { setName(event.target.value); clearFieldError('name'); }}
              maxLength={100}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'job-name-error' : 'job-name-help'}
            />
            {fieldErrors.name ? (
              <span className="field-error" id="job-name-error">{fieldErrors.name}</span>
            ) : (
              <span className="form-note" id="job-name-help">Use a name that helps you recognize what is being mirrored.</span>
            )}
          </div>
        </section>

        <section className="creation-step" aria-labelledby="job-source-heading">
          <span className="step-number" aria-hidden="true">2</span>
          <div className="creation-step-content">
            <h2 id="job-source-heading">Choose the source</h2>
            <p className="form-note">{sourceDescription}</p>
            <label htmlFor="job-source">Source folder</label>
            <span className="path-control">
              <input
                id="job-source"
                value={sourcePath}
                onChange={(event) => { setSourcePath(event.target.value); clearFieldError('sourcePath'); }}
                aria-invalid={Boolean(fieldErrors.sourcePath)}
                aria-describedby={fieldErrors.sourcePath ? 'job-source-error' : undefined}
              />
              <button type="button" onClick={() => void chooseFolder('sourcePath')} disabled={busy}>Browse…</button>
            </span>
            {fieldErrors.sourcePath && <span className="field-error" id="job-source-error">{fieldErrors.sourcePath}</span>}
          </div>
        </section>

        <section className="creation-step" aria-labelledby="job-destination-heading">
          <span className="step-number" aria-hidden="true">3</span>
          <div className="creation-step-content">
            <h2 id="job-destination-heading">Choose the destination</h2>
            <p className="form-note">{destinationDescription}</p>
            <label htmlFor="job-destination">Destination folder</label>
            <span className="path-control">
              <input
                id="job-destination"
                value={destinationPath}
                onChange={(event) => { setDestinationPath(event.target.value); clearFieldError('destinationPath'); }}
                aria-invalid={Boolean(fieldErrors.destinationPath)}
                aria-describedby={fieldErrors.destinationPath ? 'job-destination-error' : undefined}
              />
              <button type="button" onClick={() => void chooseFolder('destinationPath')} disabled={busy}>Browse…</button>
            </span>
            {fieldErrors.destinationPath && (
              <span className="field-error" id="job-destination-error">{fieldErrors.destinationPath}</span>
            )}
          </div>
        </section>

        <section className="creation-review" aria-labelledby="job-review-heading">
          <h2 id="job-review-heading">Review</h2>
          <dl className="creation-review-list">
            <dt>Job</dt><dd>{name.trim() || 'Not set'}</dd>
            <dt>Source</dt><dd title={sourcePath}>{sourcePath || 'Not set'}</dd>
            <dt>Destination</dt><dd title={destinationPath}>{destinationPath || 'Not set'}</dd>
            <dt>Automation</dt><dd>Off until you enable it</dd>
          </dl>
        </section>

        {formError && <p className="error" role="alert">{formError}</p>}
        <div className="form-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Back to jobs</button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Validating and saving…' : 'Save mirror job'}
          </button>
        </div>
        {busy && <p className="loading-state" role="status">Checking folder paths and saving the job…</p>}
      </form>
    </section>
  );
}
