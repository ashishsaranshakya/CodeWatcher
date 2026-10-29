import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { ExclusionRule, MirrorJob, SyncPreview, SyncRunResult } from '../shared/jobs';
import ExclusionsEditor from './ExclusionsEditor';
import PreviewPanel from './PreviewPanel';

export default function App() {
  const [version, setVersion] = useState('Loading…');
  const [jobs, setJobs] = useState<MirrorJob[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [activeCopies, setActiveCopies] = useState<Record<string, boolean>>({});
  const [runResults, setRunResults] = useState<Record<string, SyncRunResult>>({});

  useEffect(() => {
    void Promise.all([window.codeMirror.getVersion(), window.codeMirror.listJobs()])
      .then(([appVersion, existingJobs]) => {
        setVersion(appVersion);
        setJobs(existingJobs);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load saved jobs.');
      });
  }, []);

  async function chooseFolder(setPath: (value: string) => void): Promise<void> {
    setError('');
    try {
      const selected = await window.codeMirror.selectFolder();
      if (selected) setPath(selected);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : 'Folder selection failed.');
    }
  }

  async function submitJob(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await window.codeMirror.createJob({ name, sourcePath, destinationPath });
      setJobs(await window.codeMirror.listJobs());
      setName('');
      setSourcePath('');
      setDestinationPath('');
      setShowForm(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not save this job.');
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(job: MirrorJob): Promise<void> {
    if (!window.confirm(`Remove the job "${job.name}"? Its source and destination folders will not be deleted.`)) {
      return;
    }
    setError('');
    try {
      await window.codeMirror.deleteJob(job.id);
      setJobs(await window.codeMirror.listJobs());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove this job.');
    }
  }

  async function previewJob(job: MirrorJob): Promise<void> {
    setError('');
    setPreviewBusy(true);
    setPreview(null);
    try {
      setPreview(await window.codeMirror.previewJob(job.id));
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Could not create the preview.');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function copyJob(job: MirrorJob): Promise<void> {
    setError('');
    setActiveCopies((current) => ({ ...current, [job.id]: true }));
    try {
      const result = await window.codeMirror.copyNow(job.id);
      setRunResults((current) => ({ ...current, [job.id]: result }));
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'The mirror did not complete.');
    } finally {
      setActiveCopies((current) => ({ ...current, [job.id]: false }));
    }
  }

  async function cancelCopy(job: MirrorJob): Promise<void> {
    setError('');
    try {
      const cancelled = await window.codeMirror.cancelCopy(job.id);
      if (!cancelled) setError('The copy process has already completed or could not be stopped.');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not stop the copy process.');
    }
  }

  function updateJobExclusions(jobId: string, exclusions: ExclusionRule[]): void {
    setJobs((currentJobs) =>
      currentJobs.map((job) => (job.id === jobId ? { ...job, exclusions } : job)),
    );
    setPreview(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">CM</div>
        <div>
          <h1>CodeMirror</h1>
          <p>Filtered folder mirrors, managed locally</p>
        </div>
        <span className="version">Version {version}</span>
      </header>
      <section className="content" aria-labelledby="jobs-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2 id="jobs-title">Mirror jobs</h2>
            <p>Jobs stay disabled for automation. Manual mirrors can overwrite or delete destination files.</p>
          </div>
          <button className="primary" type="button" onClick={() => { setShowForm(true); setError(''); }}>
            Add mirror job
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}

        {showForm && (
          <form className="job-form" onSubmit={submitJob}>
            <h3>New mirror job</h3>
            <label>
              Job name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
            </label>
            <label>
              Source folder
              <span className="path-control">
                <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} required />
                <button type="button" onClick={() => void chooseFolder(setSourcePath)}>Browse…</button>
              </span>
            </label>
            <label>
              Destination folder
              <span className="path-control">
                <input value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} required />
                <button type="button" onClick={() => void chooseFolder(setDestinationPath)}>Browse…</button>
              </span>
            </label>
            <p className="form-note">
              Both paths must stay inside the development sandbox. The source must exist; create a new destination folder in Explorer before copying. New jobs are saved disabled and never run automatically.
            </p>
            <div className="form-actions">
              <button type="button" onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save job'}
              </button>
            </div>
          </form>
        )}

        {jobs.length === 0 ? (
          <div className="empty-state">
            <h3>No mirror jobs yet</h3>
            <p>Create a job to save its source and destination configuration.</p>
          </div>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => (
              <li className="job-card" key={job.id}>
                <div className="job-card-heading">
                  <div>
                    <h3>{job.name}</h3>
                    <span className="status">Automation disabled · manual mirrors available</span>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={activeCopies[job.id]}
                    onClick={() => void removeJob(job)}
                  >
                    Remove
                  </button>
                </div>
                <div className="job-actions">
                  <button type="button" disabled={previewBusy} onClick={() => void previewJob(job)}>
                    {previewBusy ? 'Analyzing…' : 'Preview'}
                  </button>
                  <span>Preview is read-only; it never runs Robocopy.</span>
                </div>
                <div className="job-actions">
                  {activeCopies[job.id] ? (
                    <button type="button" className="text-button" onClick={() => void cancelCopy(job)}>
                      Cancel copy
                    </button>
                  ) : (
                    <button type="button" onClick={() => void copyJob(job)}>
                      Mirror now (/MIR)
                    </button>
                  )}
                  {runResults[job.id] && (
                    <span role="status">
                      Last copy: {runResults[job.id].outcome} · {runResults[job.id].summary}
                    </span>
                  )}
                </div>
                <dl>
                  <dt>Source</dt><dd title={job.sourcePath}>{job.sourcePath}</dd>
                  <dt>Destination</dt><dd title={job.destinationPath}>{job.destinationPath}</dd>
                </dl>
                <details className="job-exclusions">
                  <summary>Exclusions ({job.exclusions.length} custom or preset rules)</summary>
                  <ExclusionsEditor job={job} onSaved={updateJobExclusions} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer>Local mirror status does not indicate whether Google Drive has finished uploading.</footer>
    </main>
  );
}
