import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ExclusionRule,
  MirrorJob,
  RunHistoryEntry,
  SyncPreview,
  SyncRunResult,
} from '../shared/jobs';
import ExclusionsEditor from './ExclusionsEditor';
import PreviewPanel from './PreviewPanel';

export default function App() {
  const [version, setVersion] = useState('Loading…');
  const [jobs, setJobs] = useState<MirrorJob[]>([]);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [activeCopies, setActiveCopies] = useState<Record<string, boolean>>({});
  const [automationBusy, setAutomationBusy] = useState<Record<string, boolean>>({});
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [runResults, setRunResults] = useState<Record<string, SyncRunResult>>({});

  useEffect(() => {
    void Promise.all([
      window.codeMirror.getVersion(),
      window.codeMirror.listJobs(),
      window.codeMirror.listRunHistory(),
    ])
      .then(([appVersion, existingJobs, history]) => {
        setVersion(appVersion);
        setJobs(existingJobs);
        setRunHistory(history);
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
      setRunHistory(await window.codeMirror.listRunHistory());
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'The mirror did not complete.');
    } finally {
      setActiveCopies((current) => ({ ...current, [job.id]: false }));
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setError('');
    setNotice('');
    setDiagnosticsBusy(true);
    try {
      const saved = await window.codeMirror.exportDiagnostics();
      if (saved) setNotice('Diagnostics exported. Review the file before sharing it.');
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Could not export diagnostics.',
      );
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function refreshHistory(): Promise<void> {
    setError('');
    setHistoryBusy(true);
    try {
      setRunHistory(await window.codeMirror.listRunHistory());
    } catch (historyError) {
      setError(
        historyError instanceof Error
          ? historyError.message
          : 'Could not load mirror run history.',
      );
    } finally {
      setHistoryBusy(false);
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

  async function setJobAutomation(job: MirrorJob, enabled: boolean): Promise<void> {
    setError('');
    setAutomationBusy((current) => ({ ...current, [job.id]: true }));
    try {
      await window.codeMirror.setJobEnabled(job.id, enabled);
      setJobs(await window.codeMirror.listJobs());
    } catch (automationError) {
      setError(
        automationError instanceof Error
          ? automationError.message
          : 'Could not update automatic mirroring.',
      );
    } finally {
      setAutomationBusy((current) => ({ ...current, [job.id]: false }));
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
            <p>Automatic mirroring is optional. Every mirror uses /MIR and can overwrite or delete destination files.</p>
          </div>
          <button className="primary" type="button" onClick={() => { setShowForm(true); setError(''); }}>
            Add mirror job
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="success-note" role="status">{notice}</p>}
        <section className="diagnostics-panel" aria-labelledby="history-title">
          <div className="diagnostics-heading">
            <div>
              <span className="eyebrow">LOCAL DIAGNOSTICS</span>
              <h3 id="history-title">Recent mirror runs</h3>
            </div>
            <div className="diagnostics-actions">
              <button type="button" disabled={historyBusy} onClick={() => void refreshHistory()}>
                {historyBusy ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" disabled={diagnosticsBusy} onClick={() => void exportDiagnostics()}>
                {diagnosticsBusy ? 'Exporting…' : 'Export diagnostics'}
              </button>
            </div>
          </div>
          <p className="form-note">
            Run history and diagnostic exports describe local mirroring only; they do not report cloud upload status.
          </p>
          {runHistory.length === 0 ? (
            <p className="history-empty">No mirror runs recorded yet.</p>
          ) : (
            <div className="history-table-wrap">
              <table className="history-table">
                <thead>
                  <tr><th>Job</th><th>When</th><th>Trigger</th><th>Result</th><th>Duration</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {runHistory.slice(0, 25).map((run) => (
                    <tr key={run.runId}>
                      <td>{run.jobName}</td>
                      <td>{new Date(run.startedAt).toLocaleString()}</td>
                      <td>{run.trigger}</td>
                      <td>{run.outcome}</td>
                      <td>{run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)} s`}</td>
                      <td>{run.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
              Both paths must stay inside the development sandbox. The source must exist; create a new destination folder in Explorer before copying. New jobs are saved disabled.
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
                    <span className="status">
                      {job.enabled ? 'Automatic mirroring enabled · manual mirrors available' : 'Automation disabled · manual mirrors available'}
                    </span>
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
                <label className="automation-toggle">
                  <input
                    type="checkbox"
                    checked={job.enabled}
                    disabled={automationBusy[job.id] || activeCopies[job.id]}
                    onChange={(event) => void setJobAutomation(job, event.target.checked)}
                  />
                  {automationBusy[job.id] ? 'Updating automatic mirroring…' : 'Mirror automatically at startup, on source changes, and daily'}
                </label>
                <p className="form-note">
                  Automatic mirrors run without a confirmation prompt. /MIR can delete destination-only files.
                </p>
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
                      Mirror now
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
