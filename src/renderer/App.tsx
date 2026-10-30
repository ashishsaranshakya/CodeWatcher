import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ExclusionRule,
  MirrorJob,
  RunHistoryEntry,
  SyncPreview,
  SyncRunResult,
} from '../shared/jobs';
import ExclusionsEditor from './ExclusionsEditor';
import { getLatestRunsByJob } from './job-workspace';
import { jobRoute, navigationItems, routeFromHash, type AppRoute } from './navigation';
import { getOverviewSummary } from './overview';
import PreviewPanel from './PreviewPanel';

export default function App() {
  const [version, setVersion] = useState('Loading…');
  const [restrictToSandbox, setRestrictToSandbox] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<MirrorJob[]>([]);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash(window.location.hash));
  const [isLoading, setIsLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [formError, setFormError] = useState('');
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [activeCopies, setActiveCopies] = useState<Record<string, boolean>>({});
  const [cancellingCopies, setCancellingCopies] = useState<Record<string, boolean>>({});
  const [automationBusy, setAutomationBusy] = useState<Record<string, boolean>>({});
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [runResults, setRunResults] = useState<Record<string, SyncRunResult>>({});

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setWorkspaceError('');
    try {
      const [appVersion, runtimeInfo, existingJobs, history] = await Promise.all([
        window.codeMirror.getVersion(),
        window.codeMirror.getRuntimeInfo(),
        window.codeMirror.listJobs(),
        window.codeMirror.listRunHistory(),
      ]);
      setVersion(appVersion);
      setRestrictToSandbox(runtimeInfo.restrictToSandbox);
      setJobs(existingJobs);
      setRunHistory(history);
    } catch (loadError: unknown) {
      setWorkspaceError(
        loadError instanceof Error ? loadError.message : 'Could not load CodeMirror data.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/overview');
    }
    const updateRoute = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', updateRoute);
    window.addEventListener('popstate', updateRoute);
    void loadWorkspace();
    return () => {
      window.removeEventListener('hashchange', updateRoute);
      window.removeEventListener('popstate', updateRoute);
    };
  }, [loadWorkspace]);

  async function chooseFolder(setPath: (value: string) => void): Promise<void> {
    setFormError('');
    try {
      const selected = await window.codeMirror.selectFolder();
      if (selected) setPath(selected);
    } catch (selectionError) {
      setFormError(
        selectionError instanceof Error ? selectionError.message : 'Folder selection failed.',
      );
    }
  }

  async function submitJob(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      await window.codeMirror.createJob({ name, sourcePath, destinationPath });
      setJobs(await window.codeMirror.listJobs());
      setName('');
      setSourcePath('');
      setDestinationPath('');
      setShowForm(false);
    } catch (createError) {
      setFormError(createError instanceof Error ? createError.message : 'Could not save this job.');
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(job: MirrorJob): Promise<void> {
    setJobErrors((current) => ({ ...current, [job.id]: '' }));
    try {
      await window.codeMirror.deleteJob(job.id);
      setJobs(await window.codeMirror.listJobs());
      setConfirmingRemovalId(null);
      if (route.jobId === job.id) window.location.hash = '#/jobs';
    } catch (deleteError) {
      setJobErrors((current) => ({
        ...current,
        [job.id]: deleteError instanceof Error ? deleteError.message : 'Could not remove this job.',
      }));
    }
  }

  async function previewJob(job: MirrorJob): Promise<void> {
    setJobErrors((current) => ({ ...current, [job.id]: '' }));
    setPreviewJobId(job.id);
    setPreview(null);
    try {
      setPreview(await window.codeMirror.previewJob(job.id));
    } catch (previewError) {
      setJobErrors((current) => ({
        ...current,
        [job.id]:
          previewError instanceof Error ? previewError.message : 'Could not create the preview.',
      }));
    } finally {
      setPreviewJobId(null);
    }
  }

  async function copyJob(job: MirrorJob): Promise<void> {
    setJobErrors((current) => ({ ...current, [job.id]: '' }));
    setActiveCopies((current) => ({ ...current, [job.id]: true }));
    try {
      const result = await window.codeMirror.copyNow(job.id);
      setRunResults((current) => ({ ...current, [job.id]: result }));
      setRunHistory(await window.codeMirror.listRunHistory());
    } catch (copyError) {
      setJobErrors((current) => ({
        ...current,
        [job.id]:
          copyError instanceof Error ? copyError.message : 'The mirror did not complete.',
      }));
    } finally {
      setActiveCopies((current) => ({ ...current, [job.id]: false }));
    }
  }

  async function exportDiagnostics(): Promise<void> {
    setDiagnosticsError('');
    setNotice('');
    setDiagnosticsBusy(true);
    try {
      const saved = await window.codeMirror.exportDiagnostics();
      if (saved) setNotice('Diagnostics exported. Review the file before sharing it.');
    } catch (exportError) {
      setDiagnosticsError(
        exportError instanceof Error
          ? exportError.message
          : 'Could not export diagnostics.',
      );
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function refreshHistory(): Promise<void> {
    setDiagnosticsError('');
    setHistoryBusy(true);
    try {
      setRunHistory(await window.codeMirror.listRunHistory());
    } catch (historyError) {
      setDiagnosticsError(
        historyError instanceof Error
          ? historyError.message
          : 'Could not load mirror run history.',
      );
    } finally {
      setHistoryBusy(false);
    }
  }

  async function cancelCopy(job: MirrorJob): Promise<void> {
    setJobErrors((current) => ({ ...current, [job.id]: '' }));
    setCancellingCopies((current) => ({ ...current, [job.id]: true }));
    try {
      const cancelled = await window.codeMirror.cancelCopy(job.id);
      if (!cancelled) {
        setJobErrors((current) => ({
          ...current,
          [job.id]: 'The mirror has already completed or could not be stopped.',
        }));
      }
    } catch (cancelError) {
      setJobErrors((current) => ({
        ...current,
        [job.id]:
          cancelError instanceof Error ? cancelError.message : 'Could not stop the mirror.',
      }));
    } finally {
      setCancellingCopies((current) => ({ ...current, [job.id]: false }));
    }
  }

  async function setJobAutomation(job: MirrorJob, enabled: boolean): Promise<void> {
    setJobErrors((current) => ({ ...current, [job.id]: '' }));
    setAutomationBusy((current) => ({ ...current, [job.id]: true }));
    try {
      await window.codeMirror.setJobEnabled(job.id, enabled);
      setJobs(await window.codeMirror.listJobs());
    } catch (automationError) {
      setJobErrors((current) => ({
        ...current,
        [job.id]:
          automationError instanceof Error
            ? automationError.message
            : 'Could not update automatic mirroring.',
      }));
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

  function formatOutcome(outcome: SyncRunResult['outcome']): string {
    switch (outcome) {
      case 'timed_out':
        return 'Timed out';
      case 'success':
        return 'Succeeded';
      case 'warning':
        return 'Completed with warnings';
      case 'failure':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
    }
  }

  function formatTrigger(trigger: RunHistoryEntry['trigger']): string {
    switch (trigger) {
      case 'manual':
        return 'Manual';
      case 'startup':
        return 'Startup';
      case 'watcher':
        return 'Source change';
      case 'daily':
        return 'Daily reconciliation';
      case 'one-shot':
        return 'One-time run';
    }
  }

  const selectedJob = route.jobId ? jobs.find((job) => job.id === route.jobId) : undefined;
  const latestRunsByJob = getLatestRunsByJob(runHistory);
  const overviewSummary = getOverviewSummary(jobs, runHistory);
  const routeIsMissing =
    route.page === 'not-found' ||
    Boolean(route.jobId && !isLoading && !workspaceError && !selectedJob);
  const pageTitle =
    route.page === 'jobs' && selectedJob
      ? selectedJob.name
      : navigationItems.find((item) => item.page === route.page)?.label ?? 'Page not found';

  useEffect(() => {
    document.title = `${pageTitle} · CodeMirror`;
  }, [pageTitle]);

  function startNewJob(): void {
    setShowForm(true);
    setFormError('');
    window.location.hash = '#/jobs';
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview" aria-label="CodeMirror home">
          <span className="brand-mark" aria-hidden="true">CM</span>
          <span className="brand-copy">
            <strong>CodeMirror</strong>
            <span>Folder mirroring</span>
          </span>
        </a>
        <nav className="primary-navigation" aria-label="Main navigation">
          {navigationItems.map((item) => (
            <a
              className="navigation-link"
              href={`#/${item.page}`}
              key={item.page}
              aria-current={route.page === item.page ? 'page' : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">Your files stay on this PC.</div>
      </aside>

      <div className="app-main">
        <header className="app-header">
          <span>Local folder mirroring</span>
          <span className="version">Version {version}</span>
        </header>

        <main className="app-content" id="main-content">
          {workspaceError && (
            <div className="error page-error" role="alert">
              <p>{workspaceError}</p>
              <button type="button" onClick={() => void loadWorkspace()}>Try again</button>
            </div>
          )}
          {routeIsMissing ? (
            <section className="page-section" aria-labelledby="not-found-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">NOT FOUND</span>
                  <h1 className="page-title" id="not-found-title">This page isn’t available</h1>
                  <p>The link may be invalid, or the mirror job may have been removed.</p>
                </div>
              </div>
              <a className="primary button-link" href="#/jobs">Back to mirror jobs</a>
            </section>
          ) : route.page === 'overview' ? (
            <section className="page-section" aria-labelledby="overview-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">YOUR WORKSPACE</span>
                  <h1 className="page-title" id="overview-title">
                    {jobs.length === 0 ? 'Welcome to CodeMirror' : 'Overview'}
                  </h1>
                  <p>
                    {jobs.length === 0
                      ? 'Set up your first local folder mirror.'
                      : 'A quick view of your mirror jobs and recent local activity.'}
                  </p>
                </div>
                {!isLoading && !workspaceError && jobs.length > 0 && (
                  <button className="primary" type="button" onClick={startNewJob}>
                    Add mirror job
                  </button>
                )}
              </div>

              {workspaceError ? null : isLoading ? (
                <p className="loading-state" role="status">Loading your workspace…</p>
              ) : jobs.length === 0 ? (
                <div className="welcome-panel first-run-panel">
                  <span className="welcome-icon" aria-hidden="true">↔</span>
                  <h2>Keep important folders in sync</h2>
                  <p>
                    A mirror job connects a source folder to a destination folder. You can run it
                    manually or enable automatic mirroring later.
                  </p>
                  <button className="primary" type="button" onClick={startNewJob}>
                    Create your first mirror job
                  </button>
                  <p className="form-note">
                    Mirroring happens on this PC. A completed local mirror does not confirm that
                    Google Drive has finished uploading.
                  </p>
                </div>
              ) : (
                <>
                  <section className="overview-metrics" aria-label="Workspace summary">
                    <article className="overview-metric">
                      <span className="overview-metric-label">Mirror jobs</span>
                      <strong>{overviewSummary.totalJobs}</strong>
                      <a href="#/jobs">View all jobs</a>
                    </article>
                    <article className="overview-metric">
                      <span className="overview-metric-label">Automatic mirroring</span>
                      <strong>{overviewSummary.automatedJobs}</strong>
                      <span className="overview-metric-caption">
                        of {overviewSummary.totalJobs} {overviewSummary.totalJobs === 1 ? 'job' : 'jobs'} enabled
                      </span>
                    </article>
                    <article
                      className={`overview-metric ${
                        overviewSummary.attentionJobs.length > 0 ? 'needs-attention' : ''
                      }`}
                    >
                      <span className="overview-metric-label">Needs attention</span>
                      <strong>{overviewSummary.attentionJobs.length}</strong>
                      <span className="overview-metric-caption">
                        {overviewSummary.attentionJobs.length > 0
                          ? 'latest run needs review'
                          : 'based on latest recorded runs'}
                      </span>
                    </article>
                  </section>

                  {overviewSummary.attentionJobs.length > 0 ? (
                    <section className="overview-attention" aria-labelledby="attention-title">
                      <div className="overview-section-heading">
                        <div>
                          <span className="eyebrow">REVIEW NEEDED</span>
                          <h2 id="attention-title">Some jobs need attention</h2>
                        </div>
                      </div>
                      <ul className="overview-attention-list">
                        {overviewSummary.attentionJobs.map(({ job, run }) => (
                          <li key={job.id}>
                            <div>
                              <a href={jobRoute(job.id)}>{job.name}</a>
                              <span>
                                {formatOutcome(run.outcome)} · {new Date(run.startedAt).toLocaleString()}
                              </span>
                              <span>{run.summary || 'Open Activity to review this run.'}</span>
                            </div>
                            <a className="attention-action" href="#/activity">
                              Review activity
                            </a>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : (
                    <section
                      className={`overview-health ${
                        jobs.length === overviewSummary.jobsWithoutRuns ? 'is-neutral' : ''
                      }`}
                      aria-live="polite"
                    >
                      <span className="health-mark" aria-hidden="true">✓</span>
                      <div>
                        <h2>
                          {jobs.length === overviewSummary.jobsWithoutRuns
                            ? 'Your jobs are ready'
                            : 'Your jobs look good'}
                        </h2>
                        <p>
                          {jobs.length === overviewSummary.jobsWithoutRuns
                            ? 'No mirror runs have been recorded for these jobs yet. Run a job to see its results here.'
                            : `No latest run needs attention. ${
                                overviewSummary.jobsWithoutRuns > 0
                                  ? `${overviewSummary.jobsWithoutRuns} ${
                                      overviewSummary.jobsWithoutRuns === 1 ? 'job has' : 'jobs have'
                                    } not run yet.`
                                  : 'All jobs have a recorded run.'
                              }`}
                        </p>
                      </div>
                      {overviewSummary.jobsWithoutRuns > 0 && (
                        <a className="secondary button-link" href="#/jobs">View mirror jobs</a>
                      )}
                    </section>
                  )}

                  <section className="overview-activity" aria-labelledby="overview-activity-title">
                    <div className="overview-section-heading">
                      <div>
                        <span className="eyebrow">LOCAL HISTORY</span>
                        <h2 id="overview-activity-title">Recent activity</h2>
                      </div>
                      <a href="#/activity">View all activity</a>
                    </div>
                    {overviewSummary.recentRuns.length === 0 ? (
                      <p className="history-empty">No mirror runs recorded yet.</p>
                    ) : (
                      <ul className="overview-run-list">
                        {overviewSummary.recentRuns.map((run) => {
                          const existingJob = jobs.some((job) => job.id === run.jobId);
                          return (
                            <li key={run.runId}>
                              <span className={`run-indicator outcome-${run.outcome}`} aria-hidden="true" />
                              <div className="overview-run-main">
                                {existingJob ? (
                                  <a href={jobRoute(run.jobId)}>{run.jobName}</a>
                                ) : (
                                  <span>{run.jobName} <span className="removed-job-label">(removed)</span></span>
                                )}
                                <span>{run.summary || formatTrigger(run.trigger)}</span>
                              </div>
                              <span className={`run-outcome outcome-${run.outcome}`}>
                                {formatOutcome(run.outcome)}
                              </span>
                              <time dateTime={run.startedAt}>
                                {new Date(run.startedAt).toLocaleString()}
                              </time>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <p className="form-note">
                      This is local mirror activity only; it does not report Google Drive upload status.
                    </p>
                  </section>
                </>
              )}
            </section>
          ) : route.page === 'jobs' ? (
            <section className="page-section" aria-labelledby="jobs-title">
              <div className="section-heading">
                <div>
                  {selectedJob && (
                    <a className="back-link" href="#/jobs">← All mirror jobs</a>
                  )}
                  <span className="eyebrow">{selectedJob ? 'MIRROR JOB' : 'YOUR WORKSPACE'}</span>
                  <h1 className="page-title" id="jobs-title">
                    {selectedJob ? selectedJob.name : 'Mirror jobs'}
                  </h1>
                  <p>
                    Mirroring uses /MIR, which can overwrite changed destination files and delete
                    destination-only files. Preview is read-only.
                  </p>
                </div>
                {!selectedJob && (
                  <button
                    className="primary"
                    type="button"
                    disabled={isLoading || Boolean(workspaceError)}
                    onClick={() => { setShowForm(true); setFormError(''); }}
                  >
                    Add mirror job
                  </button>
                )}
              </div>

              {notice && <p className="success-note" role="status">{notice}</p>}
              {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}

              {showForm && !selectedJob && (
                <form className="job-form" onSubmit={submitJob} aria-busy={busy}>
                  <h2>New mirror job</h2>
                  <label>
                    Job name
                    <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required />
                  </label>
                  <label>
                    Source folder
                    <span className="path-control">
                      <input
                        value={sourcePath}
                        onChange={(event) => setSourcePath(event.target.value)}
                        aria-label="Source folder path"
                        required
                      />
                      <button
                        type="button"
                        aria-label="Browse for source folder"
                        onClick={() => void chooseFolder(setSourcePath)}
                      >
                        Browse…
                      </button>
                    </span>
                  </label>
                  <label>
                    Destination folder
                    <span className="path-control">
                      <input
                        value={destinationPath}
                        onChange={(event) => setDestinationPath(event.target.value)}
                        aria-label="Destination folder path"
                        required
                      />
                      <button
                        type="button"
                        aria-label="Browse for destination folder"
                        onClick={() => void chooseFolder(setDestinationPath)}
                      >
                        Browse…
                      </button>
                    </span>
                  </label>
                  <p className="form-note">
                    {restrictToSandbox === true
                      ? 'For development safety, both folders must be inside the CodeWatcher sandbox.'
                      : 'Choose an existing source folder and a destination folder. New jobs are saved with automatic mirroring off.'}{' '}
                    The source must exist, and the destination folder must already exist.
                  </p>
                  {formError && <p className="error" role="alert">{formError}</p>}
                  <div className="form-actions">
                    <button type="button" onClick={() => { setShowForm(false); setFormError(''); }}>
                      Cancel
                    </button>
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? 'Saving…' : 'Save job'}
                    </button>
                  </div>
                </form>
              )}

              {workspaceError ? null : isLoading ? (
                <p className="loading-state" role="status">Loading mirror jobs…</p>
              ) : jobs.length === 0 ? (
                <div className="empty-state">
                  <h2>No mirror jobs yet</h2>
                  <p>Create a job to save its source and destination configuration.</p>
                  <button className="primary" type="button" onClick={() => setShowForm(true)}>
                    Create your first job
                  </button>
                </div>
              ) : selectedJob ? (
                <ul className="job-list">
                  {[selectedJob].map((job) => (
                    <li
                      className="job-card"
                      key={job.id}
                      aria-busy={
                        activeCopies[job.id] ||
                        cancellingCopies[job.id] ||
                        automationBusy[job.id] ||
                        previewJobId === job.id ||
                        undefined
                      }
                    >
                      <div className="job-card-heading">
                        <div>
                          <h2>{job.name}</h2>
                          <span className={`status-badge ${job.enabled ? 'is-enabled' : 'is-disabled'}`}>
                            Automation {job.enabled ? 'on' : 'off'}
                          </span>
                          <span className="status-detail">Manual mirrors are available.</span>
                        </div>
                        {confirmingRemovalId === job.id ? (
                          <div className="remove-confirmation" role="group" aria-label={`Remove ${job.name}`}>
                            <p>Remove this job? Its source and destination folders will not be deleted.</p>
                            <button type="button" onClick={() => setConfirmingRemovalId(null)}>Keep job</button>
                            <button
                              type="button"
                              className="text-button destructive"
                              disabled={activeCopies[job.id]}
                              onClick={() => void removeJob(job)}
                            >
                              Remove job
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="text-button destructive"
                            disabled={activeCopies[job.id]}
                            aria-label={`Remove job ${job.name}`}
                            onClick={() => setConfirmingRemovalId(job.id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <label className="automation-toggle" aria-busy={automationBusy[job.id] || undefined}>
                        <input
                          type="checkbox"
                          checked={job.enabled}
                          disabled={automationBusy[job.id] || activeCopies[job.id]}
                          aria-label={`Enable automatic mirroring for ${job.name}`}
                          onChange={(event) => void setJobAutomation(job, event.target.checked)}
                        />
                        {automationBusy[job.id] ? 'Updating automation…' : 'Enable automatic mirroring'}
                      </label>
                      <p className="form-note">
                        Runs at startup, when source files change, and daily. Automatic mirrors use
                        /MIR and can delete destination-only files.
                      </p>
                      <div className="job-actions">
                        <button
                          type="button"
                          disabled={previewJobId !== null}
                          aria-label={`Preview mirror job ${job.name}`}
                          onClick={() => void previewJob(job)}
                        >
                          {previewJobId === job.id ? 'Analyzing…' : 'Preview'}
                        </button>
                        <span>Preview is read-only; it never runs Robocopy.</span>
                      </div>
                      <div className="job-actions">
                        {activeCopies[job.id] ? (
                          <button
                            type="button"
                            className="text-button"
                            disabled={cancellingCopies[job.id]}
                            aria-label={`Cancel mirror for ${job.name}`}
                            onClick={() => void cancelCopy(job)}
                          >
                            {cancellingCopies[job.id] ? 'Stopping…' : 'Cancel mirror'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Mirror now: ${job.name}`}
                            onClick={() => void copyJob(job)}
                          >
                            Mirror now
                          </button>
                        )}
                        {activeCopies[job.id] && (
                          <span role="status">
                            {cancellingCopies[job.id] ? 'Stopping mirror…' : 'Mirror in progress…'}
                          </span>
                        )}
                        {runResults[job.id] && (
                          <span role="status">
                            Last mirror: {formatOutcome(runResults[job.id].outcome)} · {runResults[job.id].summary}
                          </span>
                        )}
                      </div>
                      <p className="form-note">
                        Mirror now uses /MIR and can overwrite changed files or delete destination-only files.
                      </p>
                      {jobErrors[job.id] && <p className="error" role="alert">{jobErrors[job.id]}</p>}
                      <dl className="job-detail-paths">
                        <dt>Source</dt>
                        <dd>
                          <details className="job-path-disclosure">
                            <summary title={job.sourcePath}>{job.sourcePath}</summary>
                            <code>{job.sourcePath}</code>
                          </details>
                        </dd>
                        <dt>Destination</dt>
                        <dd>
                          <details className="job-path-disclosure">
                            <summary title={job.destinationPath}>{job.destinationPath}</summary>
                            <code>{job.destinationPath}</code>
                          </details>
                        </dd>
                      </dl>
                      <details className="job-exclusions">
                        <summary>Exclusions ({job.exclusions.length} custom or preset rules)</summary>
                        <ExclusionsEditor job={job} onSaved={updateJobExclusions} />
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="job-list">
                  {jobs.map((job) => {
                    const latestRun = latestRunsByJob.get(job.id);
                    const latestResult = runResults[job.id] ?? latestRun;
                    return (
                      <li
                        className="job-list-card"
                        key={job.id}
                        aria-busy={
                          activeCopies[job.id] ||
                          cancellingCopies[job.id] ||
                          previewJobId === job.id ||
                          undefined
                        }
                      >
                        <div className="job-list-card-heading">
                          <div className="job-list-identity">
                            <a className="job-title-link" href={jobRoute(job.id)}>{job.name}</a>
                            <span className={`status-badge ${job.enabled ? 'is-enabled' : 'is-disabled'}`}>
                              Automation {job.enabled ? 'on' : 'off'}
                            </span>
                          </div>
                          <div className="job-list-run">
                            {activeCopies[job.id] ? (
                              <span className="run-outcome outcome-in-progress" role="status">
                                {cancellingCopies[job.id] ? 'Stopping mirror…' : 'Mirror in progress…'}
                              </span>
                            ) : latestResult ? (
                              <>
                                <span className={`run-outcome outcome-${latestResult.outcome}`}>
                                  {formatOutcome(latestResult.outcome)}
                                </span>
                                {latestResult.summary && <span title={latestResult.summary}>{latestResult.summary}</span>}
                                <time dateTime={latestResult.startedAt}>
                                  {new Date(latestResult.startedAt).toLocaleString()}
                                </time>
                              </>
                            ) : (
                              <span className="run-outcome">Not run yet</span>
                            )}
                          </div>
                        </div>
                        <div className="job-list-paths">
                          <details className="job-path-disclosure">
                            <summary title={job.sourcePath}>Source <span>{job.sourcePath}</span></summary>
                            <code>{job.sourcePath}</code>
                          </details>
                          <details className="job-path-disclosure">
                            <summary title={job.destinationPath}>Destination <span>{job.destinationPath}</span></summary>
                            <code>{job.destinationPath}</code>
                          </details>
                        </div>
                        <div className="job-list-actions">
                          <a className="secondary button-link" href={jobRoute(job.id)}>Open details</a>
                          <button
                            type="button"
                            disabled={previewJobId !== null}
                            onClick={() => void previewJob(job)}
                          >
                            {previewJobId === job.id ? 'Analyzing…' : 'Preview'}
                          </button>
                          {activeCopies[job.id] ? (
                            <button
                              type="button"
                              className="text-button"
                              disabled={cancellingCopies[job.id]}
                              onClick={() => void cancelCopy(job)}
                            >
                              {cancellingCopies[job.id] ? 'Stopping…' : 'Cancel mirror'}
                            </button>
                          ) : (
                            <button className="primary" type="button" onClick={() => void copyJob(job)}>
                              Mirror now
                            </button>
                          )}
                          {confirmingRemovalId === job.id ? (
                            <div className="remove-confirmation" role="group" aria-label={`Remove ${job.name}`}>
                              <p>Remove this job? Its source and destination folders will not be deleted.</p>
                              <button type="button" onClick={() => setConfirmingRemovalId(null)}>Keep job</button>
                              <button
                                type="button"
                                className="text-button destructive"
                                disabled={activeCopies[job.id]}
                                onClick={() => void removeJob(job)}
                              >
                                Remove job
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="text-button destructive"
                              disabled={activeCopies[job.id]}
                              onClick={() => setConfirmingRemovalId(job.id)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        <p className="job-list-safety-note">
                          Preview is read-only. Mirror now uses /MIR and can overwrite changed destination
                          files or delete destination-only files.
                        </p>
                        {jobErrors[job.id] && <p className="error" role="alert">{jobErrors[job.id]}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : route.page === 'activity' ? (
            <section className="page-section" aria-labelledby="activity-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">LOCAL HISTORY</span>
                  <h1 className="page-title" id="activity-title">Activity</h1>
                  <p>Review recent mirror runs and export local diagnostics.</p>
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
              {notice && <p className="success-note" role="status">{notice}</p>}
              {diagnosticsError && <p className="error" role="alert">{diagnosticsError}</p>}
              <p className="form-note activity-note">
                Run history and diagnostic exports describe local mirroring only. They do not report
                whether Google Drive has finished uploading.
              </p>
              {workspaceError ? null : isLoading || historyBusy ? (
                <p className="loading-state" role="status">
                  {historyBusy ? 'Refreshing activity…' : 'Loading activity…'}
                </p>
              ) : runHistory.length === 0 ? (
                <div className="empty-state">
                  <h2>No mirror activity yet</h2>
                  <p>Completed mirror runs will appear here.</p>
                  <a className="secondary button-link" href="#/jobs">View mirror jobs</a>
                </div>
              ) : (
                <div className="diagnostics-panel">
                  <div className="history-table-wrap">
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th>Job</th>
                          <th>When</th>
                          <th>Trigger</th>
                          <th>Result</th>
                          <th>Duration</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runHistory.slice(0, 25).map((run) => (
                          <tr key={run.runId}>
                            <td>
                              <a href={jobRoute(run.jobId)}>{run.jobName}</a>
                            </td>
                            <td>{new Date(run.startedAt).toLocaleString()}</td>
                            <td>{formatTrigger(run.trigger)}</td>
                            <td>{formatOutcome(run.outcome)}</td>
                            <td>{run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)} s`}</td>
                            <td>{run.summary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          ) : route.page === 'settings' ? (
            <section className="page-section" aria-labelledby="settings-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">APPLICATION</span>
                  <h1 className="page-title" id="settings-title">Settings</h1>
                  <p>Application information and support options.</p>
                </div>
              </div>
              <section className="settings-card" aria-labelledby="about-title">
                <h2 id="about-title">About CodeMirror</h2>
                <dl className="settings-list">
                  <dt>Version</dt>
                  <dd>{version}</dd>
                  <dt>Storage</dt>
                  <dd>Local to this Windows user account</dd>
                </dl>
                <p className="form-note">
                  CodeMirror stores job configuration and run history on this PC. Diagnostic
                  exports are created only when you request them.
                </p>
                <a className="secondary button-link" href="#/activity">Open activity and diagnostics</a>
              </section>
            </section>
          ) : null}
        </main>

        <footer className="app-footer">
          Local mirror status does not indicate whether Google Drive has finished uploading.
        </footer>
      </div>
    </div>
  );
}
