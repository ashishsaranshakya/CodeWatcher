import { useCallback, useEffect, useState } from 'react';
import type {
  ExclusionRule,
  MirrorJob,
  RunHistoryEntry,
  SyncPreview,
  SyncRunResult,
} from '../shared/jobs';
import {
  DEFAULT_ACTIVITY_FILTERS,
  filterRunHistory,
  formatRunDuration,
  type ActivityFilters,
} from './activity';
import ExclusionsEditor from './ExclusionsEditor';
import JobCreationForm from './JobCreationForm';
import { getLatestRunsByJob } from './job-workspace';
import {
  jobRoute,
  navigationItems,
  routeFromHash,
  runRoute,
  type AppRoute,
  type JobSection,
} from './navigation';
import { getOverviewSummary } from './overview';
import PreviewPanel from './PreviewPanel';
import RunResultPanel from './RunResultPanel';

export default function App() {
  const [version, setVersion] = useState('Loading…');
  const [restrictToSandbox, setRestrictToSandbox] = useState<boolean | null>(null);
  const [isPackaged, setIsPackaged] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<MirrorJob[]>([]);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash(window.location.hash));
  const [isLoading, setIsLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState('');
  const [name, setName] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [destinationPath, setDestinationPath] = useState('');
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [jobErrors, setJobErrors] = useState<Record<string, string>>({});
  const [confirmingRemovalId, setConfirmingRemovalId] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [activeCopies, setActiveCopies] = useState<Record<string, boolean>>({});
  const [cancellingCopies, setCancellingCopies] = useState<Record<string, boolean>>({});
  const [automationBusy, setAutomationBusy] = useState<Record<string, boolean>>({});
  const [automationFeedback, setAutomationFeedback] = useState<Record<string, string>>({});
  const [automationErrors, setAutomationErrors] = useState<Record<string, string>>({});
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [activityFilters, setActivityFilters] = useState<ActivityFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [runResults, setRunResults] = useState<Record<string, SyncRunResult>>({});
  const [activeJobSection, setActiveJobSection] = useState<JobSection>(
    () => routeFromHash(window.location.hash).section ?? 'overview',
  );

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
      setIsPackaged(runtimeInfo.isPackaged);
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
      try {
        setRunHistory(await window.codeMirror.listRunHistory());
      } catch (historyError: unknown) {
        setRunHistory((current) => [
          {
            runId: result.runId,
            jobId: result.jobId,
            jobName: job.name,
            trigger: result.trigger,
            outcome: result.outcome,
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            summary: result.summary,
            outputTruncated: result.outputTruncated,
          },
          ...current.filter((run) => run.runId !== result.runId),
        ]);
        setJobErrors((current) => ({
          ...current,
          [job.id]: `Mirror completed, but run history could not be refreshed: ${
            historyError instanceof Error ? historyError.message : 'unknown error'
          }`,
        }));
      }
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
    setAutomationFeedback((current) => ({ ...current, [job.id]: '' }));
    setAutomationErrors((current) => ({ ...current, [job.id]: '' }));
    setAutomationBusy((current) => ({ ...current, [job.id]: true }));
    try {
      const updatedJob = await window.codeMirror.setJobEnabled(job.id, enabled);
      setJobs((currentJobs) =>
        currentJobs.map((currentJob) => currentJob.id === job.id ? updatedJob : currentJob),
      );
      const otherEnabledJobs = jobs.some((currentJob) => currentJob.id !== job.id && currentJob.enabled);
      setAutomationFeedback((current) => ({
        ...current,
        [job.id]: enabled
          ? 'Automatic mirroring is on. The scheduled worker is registered.'
          : otherEnabledJobs
            ? 'Automatic mirroring is off for this job. The worker remains registered for other enabled jobs.'
            : 'Automatic mirroring is off. The CodeMirror scheduled worker was removed.',
      }));
    } catch (automationError) {
      setAutomationErrors((current) => ({
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
  const selectedRun = route.runId ? runHistory.find((run) => run.runId === route.runId) : undefined;
  const selectedRunJob = selectedRun ? jobs.find((job) => job.id === selectedRun.jobId) : undefined;
  const filteredRuns = filterRunHistory(runHistory, activityFilters);
  const selectedJobRuns = selectedJob
    ? runHistory.filter((run) => run.jobId === selectedJob.id).slice(0, 25)
    : [];
  const latestRunsByJob = getLatestRunsByJob(runHistory);
  const overviewSummary = getOverviewSummary(jobs, runHistory);
  const routeIsMissing =
    route.page === 'not-found' ||
    Boolean(route.jobId && !isLoading && !workspaceError && !selectedJob) ||
    Boolean(route.runId && !isLoading && !workspaceError && !selectedRun);
  const pageTitle =
    route.page === 'jobs' && selectedJob
      ? selectedJob.name
      : route.page === 'activity' && selectedRun
        ? `Run · ${selectedRun.jobName} · ${new Date(selectedRun.startedAt).toLocaleString()}`
      : route.page === 'job-create'
        ? 'New mirror job'
      : navigationItems.find((item) => item.page === route.page)?.label ?? 'Page not found';

  useEffect(() => {
    document.title = `${pageTitle} · CodeMirror`;
  }, [pageTitle]);

  useEffect(() => {
    if (route.page !== 'jobs' || !route.jobId || !route.section || isLoading || !selectedJob) return;
    document.getElementById(route.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [route.page, route.jobId, route.section, isLoading, selectedJob?.id]);

  useEffect(() => {
    if (route.page !== 'jobs' || !route.jobId || isLoading || !selectedJob) return;

    let currentSection = route.section ?? 'overview';
    let animationFrame = 0;
    const sections: JobSection[] = ['overview', 'folders', 'automation', 'runs'];
    const updateActiveSection = () => {
      animationFrame = 0;
      const navigationBottom =
        document.querySelector('.job-section-navigation')?.getBoundingClientRect().bottom ?? 0;
      const activationLine = navigationBottom + 24;
      const isAtPageBottom =
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      const activeSection = isAtPageBottom
        ? 'runs'
        : sections.reduce<JobSection>((active, section) => {
            const element = document.getElementById(section);
            return element && element.getBoundingClientRect().top <= activationLine ? section : active;
          }, 'overview');

      if (activeSection === currentSection) return;
      currentSection = activeSection;
      setActiveJobSection(activeSection);
    };
    const scheduleUpdate = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(updateActiveSection);
    };

    setActiveJobSection(currentSection);
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    scheduleUpdate();

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [route.page, route.jobId, route.section, isLoading, selectedJob?.id]);

  function startNewJob(): void {
    window.location.hash = '#/jobs/new';
  }

  function handleJobCreated(job: MirrorJob): void {
    setJobs((currentJobs) => [...currentJobs, job]);
    setName('');
    setSourcePath('');
    setDestinationPath('');
    window.location.hash = jobRoute(job.id);
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
              aria-current={
                route.page === item.page || (item.page === 'jobs' && route.page === 'job-create')
                  ? 'page'
                  : undefined
              }
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        <main className="app-content" id="main-content" tabIndex={-1}>
          <div className="sr-only" aria-live="polite" aria-atomic="true">{pageTitle}</div>
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
                  </section>
                </>
              )}
            </section>
          ) : route.page === 'job-create' ? (
            <JobCreationForm
              name={name}
              setName={setName}
              sourcePath={sourcePath}
              setSourcePath={setSourcePath}
              destinationPath={destinationPath}
              setDestinationPath={setDestinationPath}
              restrictToSandbox={restrictToSandbox}
              onCreated={handleJobCreated}
              onCancel={() => { window.location.hash = '#/jobs'; }}
            />
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
                    {selectedJob
                      ? 'Manage this job’s folders, exclusions, automation, and local run history.'
                      : 'Review your local mirrors, recent results, and next actions.'}
                  </p>
                </div>
                {!selectedJob && (
                  <button
                    className="primary"
                    type="button"
                    disabled={isLoading || Boolean(workspaceError)}
                    onClick={startNewJob}
                  >
                    Add mirror job
                  </button>
                )}
              </div>

              {notice && <p className="success-note" role="status">{notice}</p>}
              {preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}

              {workspaceError ? null : isLoading ? (
                <p className="loading-state" role="status">Loading mirror jobs…</p>
              ) : route.jobId && !selectedJob ? (
                <p className="loading-state" role="status">Loading this mirror job…</p>
              ) : jobs.length === 0 ? (
                <div className="empty-state">
                  <h2>No mirror jobs yet</h2>
                  <p>Create a job to save its source and destination configuration.</p>
                  <button className="primary" type="button" onClick={startNewJob}>
                    Create your first job
                  </button>
                </div>
              ) : selectedJob ? (
                <div
                  className="job-detail-view"
                  aria-busy={
                    activeCopies[selectedJob.id] ||
                    cancellingCopies[selectedJob.id] ||
                    automationBusy[selectedJob.id] ||
                    previewJobId === selectedJob.id ||
                    undefined
                  }
                >
                  <nav className="job-section-navigation" aria-label={`${selectedJob.name} sections`}>
                    <a aria-current={activeJobSection === 'overview' ? 'location' : undefined} href={`${jobRoute(selectedJob.id)}#overview`}>Overview</a>
                    <a aria-current={activeJobSection === 'folders' ? 'location' : undefined} href={`${jobRoute(selectedJob.id)}#folders`}>Folders &amp; exclusions</a>
                    <a aria-current={activeJobSection === 'automation' ? 'location' : undefined} href={`${jobRoute(selectedJob.id)}#automation`}>Automation</a>
                    <a aria-current={activeJobSection === 'runs' ? 'location' : undefined} href={`${jobRoute(selectedJob.id)}#runs`}>Runs</a>
                  </nav>

                  <section className="job-detail-section" id="overview" aria-labelledby="job-overview-title">
                    <div className="job-detail-section-heading">
                      <div>
                        <span className={`status-badge ${selectedJob.enabled ? 'is-enabled' : 'is-disabled'}`}>
                          Automation {selectedJob.enabled ? 'on' : 'off'}
                        </span>
                        <h2 id="job-overview-title">Overview</h2>
                        <p>Run a read-only preview or start a mirror when you’re ready.</p>
                      </div>
                      {confirmingRemovalId === selectedJob.id ? (
                        <div className="remove-confirmation" role="group" aria-label={`Remove ${selectedJob.name}`}>
                          <p>Remove this job? Its source and destination folders will not be deleted.</p>
                          <button type="button" onClick={() => setConfirmingRemovalId(null)}>Keep job</button>
                          <button
                            type="button"
                            className="text-button destructive"
                            disabled={activeCopies[selectedJob.id]}
                            onClick={() => void removeJob(selectedJob)}
                          >
                            Remove job
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-button destructive"
                          disabled={activeCopies[selectedJob.id]}
                          onClick={() => setConfirmingRemovalId(selectedJob.id)}
                        >
                          Remove job
                        </button>
                      )}
                    </div>
                    <div className="job-detail-actions">
                      <button
                        type="button"
                        disabled={previewJobId !== null}
                        onClick={() => void previewJob(selectedJob)}
                      >
                        {previewJobId === selectedJob.id ? 'Analyzing…' : 'Preview changes'}
                      </button>
                      {activeCopies[selectedJob.id] ? (
                        <button
                          type="button"
                          disabled={cancellingCopies[selectedJob.id]}
                          onClick={() => void cancelCopy(selectedJob)}
                        >
                          {cancellingCopies[selectedJob.id] ? 'Stopping…' : 'Cancel mirror'}
                        </button>
                      ) : (
                        <button className="primary" type="button" onClick={() => void copyJob(selectedJob)}>
                          Mirror now
                        </button>
                      )}
                      {activeCopies[selectedJob.id] && (
                        <span role="status">
                          {cancellingCopies[selectedJob.id] ? 'Stopping mirror…' : 'Mirror in progress…'}
                        </span>
                      )}
                    </div>
                    {runResults[selectedJob.id] && (
                      <RunResultPanel
                        result={runResults[selectedJob.id]}
                        outcomeLabel={formatOutcome(runResults[selectedJob.id].outcome)}
                      />
                    )}
                    {jobErrors[selectedJob.id] && <p className="error" role="alert">{jobErrors[selectedJob.id]}</p>}
                  </section>

                  <section className="job-detail-section" id="folders" aria-labelledby="job-folders-title">
                    <div className="job-detail-section-heading">
                      <div>
                        <h2 id="job-folders-title">Folders &amp; exclusions</h2>
                        <p>Review the folders in this mirror and the rules that keep matching files out.</p>
                      </div>
                    </div>
                    <dl className="job-detail-paths">
                      <dt>Source</dt>
                      <dd>
                        <details className="job-path-disclosure">
                          <summary title={selectedJob.sourcePath}>{selectedJob.sourcePath}</summary>
                          <code>{selectedJob.sourcePath}</code>
                        </details>
                      </dd>
                      <dt>Destination</dt>
                      <dd>
                        <details className="job-path-disclosure">
                          <summary title={selectedJob.destinationPath}>{selectedJob.destinationPath}</summary>
                          <code>{selectedJob.destinationPath}</code>
                        </details>
                      </dd>
                    </dl>
                    <ExclusionsEditor
                      key={selectedJob.id}
                      job={selectedJob}
                      onSaved={updateJobExclusions}
                    />
                  </section>

                  <section className="job-detail-section" id="automation" aria-labelledby="job-automation-title">
                    <div className="job-detail-section-heading">
                      <div>
                        <h2 id="job-automation-title">Automation</h2>
                        <p>Choose whether this job runs in the background without opening CodeMirror.</p>
                      </div>
                    </div>
                    <label className="automation-toggle" aria-busy={automationBusy[selectedJob.id] || undefined}>
                      <input
                        type="checkbox"
                        checked={selectedJob.enabled}
                        disabled={automationBusy[selectedJob.id] || activeCopies[selectedJob.id]}
                        aria-label={`Enable automatic mirroring for ${selectedJob.name}`}
                        onChange={(event) => void setJobAutomation(selectedJob, event.target.checked)}
                      />
                      {automationBusy[selectedJob.id]
                        ? 'Updating automatic mirroring…'
                        : `Automatic mirroring is ${selectedJob.enabled ? 'on' : 'off'}`}
                    </label>
                    <div className="automation-explanation">
                      <h3>What automatic mirroring does</h3>
                      <ul>
                        <li>A CodeMirror background worker is registered in Windows Task Scheduler.</li>
                        <li>The worker starts at sign-in, responds to source changes, and performs a daily reconciliation.</li>
                        <li>Enabling may start a reconciliation immediately when no worker is already running.</li>
                      </ul>
                      <p>
                        Automatic runs use /MIR. Changed destination files can be overwritten and
                        destination-only files can be deleted.
                      </p>
                    </div>
                    {automationFeedback[selectedJob.id] && (
                      <p className="success-note" role="status">{automationFeedback[selectedJob.id]}</p>
                    )}
                    {automationErrors[selectedJob.id] && <p className="error" role="alert">{automationErrors[selectedJob.id]}</p>}
                  </section>

                  <section className="job-detail-section" id="runs" aria-labelledby="job-runs-title">
                    <div className="job-detail-section-heading">
                      <div>
                        <h2 id="job-runs-title">Runs</h2>
                        <p>Local mirror history for this job only.</p>
                      </div>
                      <a href="#/activity">Open all activity</a>
                    </div>
                    {selectedJobRuns.length === 0 ? (
                      <p className="history-empty">This job has no recorded runs yet.</p>
                    ) : (
                      <div className="history-table-wrap">
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>When</th><th>Trigger</th><th>Result</th><th>Duration</th><th>Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedJobRuns.map((run) => (
                                <tr key={run.runId}>
                                  <td>{new Date(run.startedAt).toLocaleString()}</td>
                                  <td>{formatTrigger(run.trigger)}</td>
                                  <td>{formatOutcome(run.outcome)}</td>
                                  <td>{run.durationMs === null ? '—' : `${(run.durationMs / 1000).toFixed(1)} s`}</td>
                                  <td>
                                    {run.summary}
                                    <a className="history-run-link" href={runRoute(run.runId)}>View run</a>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
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
                                <a className="history-run-link" href={runRoute(latestResult.runId)}>View latest run</a>
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
                        {jobErrors[job.id] && <p className="error" role="alert">{jobErrors[job.id]}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : route.page === 'activity' ? (
            <section className="page-section" aria-labelledby="activity-title">
              {route.runId && selectedRun ? (
                <>
                  <a className="back-link" href="#/activity">← Back to Activity</a>
                  <div className="section-heading run-detail-heading">
                    <div>
                      <span className="eyebrow">RUN DETAILS</span>
                      <h1 className="page-title" id="activity-title">{selectedRun.jobName}</h1>
                      <p>
                        {formatTrigger(selectedRun.trigger)} ·{' '}
                        <time dateTime={selectedRun.startedAt}>
                          {new Date(selectedRun.startedAt).toLocaleString()}
                        </time>
                      </p>
                    </div>
                    <span className={`run-outcome outcome-${selectedRun.outcome}`}>
                      {formatOutcome(selectedRun.outcome)}
                    </span>
                  </div>
                  {selectedRunJob && (
                    <a className="secondary button-link run-job-link" href={jobRoute(selectedRun.jobId)}>
                      Open mirror job
                    </a>
                  )}
                  <RunResultPanel
                    result={selectedRun}
                    outcomeLabel={formatOutcome(selectedRun.outcome)}
                  />
                </>
              ) : (
                <>
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
                  {workspaceError ? null : isLoading || historyBusy ? (
                    <p className="loading-state" role="status" aria-busy="true">
                      {historyBusy ? 'Refreshing activity…' : 'Loading activity…'}
                    </p>
                  ) : runHistory.length === 0 ? (
                    <div className="empty-state">
                      <h2>No mirror activity yet</h2>
                      <p>Completed mirror runs will appear here.</p>
                      <a className="secondary button-link" href="#/jobs">View mirror jobs</a>
                    </div>
                  ) : (
                    <>
                      <div className="activity-filters" role="group" aria-label="Filter activity">
                        <label>
                          Search runs
                          <input
                            type="search"
                            value={activityFilters.query}
                            onChange={(event) =>
                              setActivityFilters((current) => ({ ...current, query: event.target.value }))
                            }
                            placeholder="Search job names or summaries"
                          />
                        </label>
                        <label>
                          Mirror job
                          <select
                            value={activityFilters.jobId}
                            onChange={(event) =>
                              setActivityFilters((current) => ({ ...current, jobId: event.target.value }))
                            }
                          >
                            <option value="all">All mirror jobs</option>
                            {jobs.map((job) => <option key={job.id} value={job.id}>{job.name}</option>)}
                          </select>
                        </label>
                        <label>
                          Result
                          <select
                            value={activityFilters.outcome}
                            onChange={(event) =>
                              setActivityFilters((current) => ({
                                ...current,
                                outcome: event.target.value as ActivityFilters['outcome'],
                              }))
                            }
                          >
                            <option value="all">All results</option>
                            <option value="success">Succeeded</option>
                            <option value="warning">Completed with warnings</option>
                            <option value="failure">Failed</option>
                            <option value="cancelled">Cancelled</option>
                            <option value="timed_out">Timed out</option>
                          </select>
                        </label>
                        <label>
                          Sort by
                          <select
                            value={activityFilters.sort}
                            onChange={(event) =>
                              setActivityFilters((current) => ({
                                ...current,
                                sort: event.target.value as ActivityFilters['sort'],
                              }))
                            }
                          >
                            <option value="newest">Newest first</option>
                            <option value="oldest">Oldest first</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          className="text-button"
                          disabled={
                            activityFilters.query === '' &&
                            activityFilters.jobId === 'all' &&
                            activityFilters.outcome === 'all' &&
                            activityFilters.sort === 'newest'
                          }
                          onClick={() => setActivityFilters(DEFAULT_ACTIVITY_FILTERS)}
                        >
                          Clear filters
                        </button>
                      </div>
                      <p className="activity-count" role="status">
                        Showing {filteredRuns.length} of {runHistory.length} recent runs
                      </p>
                      {filteredRuns.length === 0 ? (
                        <div className="empty-state">
                          <h2>No runs match these filters</h2>
                          <p>Try a different search or clear the selected filters.</p>
                          <button type="button" onClick={() => setActivityFilters(DEFAULT_ACTIVITY_FILTERS)}>
                            Clear filters
                          </button>
                        </div>
                      ) : (
                        <ul className="activity-run-list" aria-label="Recent mirror runs">
                          {filteredRuns.map((run) => (
                            <li className="activity-run-card" key={run.runId}>
                              <div className="activity-run-card-heading">
                                <div>
                                  {jobs.some((job) => job.id === run.jobId) ? (
                                    <a className="activity-job-name" href={jobRoute(run.jobId)}>{run.jobName}</a>
                                  ) : (
                                    <strong className="activity-job-name">{run.jobName}</strong>
                                  )}
                                  <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time>
                                </div>
                                <span className={`run-outcome outcome-${run.outcome}`}>
                                  {formatOutcome(run.outcome)}
                                </span>
                              </div>
                              <p className="activity-run-summary">{run.summary}</p>
                              <dl className="activity-run-meta">
                                <div><dt>Started by</dt><dd>{formatTrigger(run.trigger)}</dd></div>
                                <div><dt>Duration</dt><dd>{formatRunDuration(run.durationMs)}</dd></div>
                                {run.exitCode !== null && <div><dt>Exit code</dt><dd>{run.exitCode}</dd></div>}
                              </dl>
                              {run.outputTruncated && (
                                <p className="warning-note">Some recorded output was truncated.</p>
                              )}
                              <a className="history-run-link" href={runRoute(run.runId)}>View run details</a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </>
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
                  <dt>Profile</dt>
                  <dd>
                    {isPackaged !== null
                      ? isPackaged
                        ? 'Installed user profile'
                        : 'Development profile'
                      : 'Loading profile information…'}
                  </dd>
                  <dt>Uninstall behavior</dt>
                  <dd>
                    {isPackaged
                      ? 'The installed profile and its owned scheduled task are removed when the app is uninstalled.'
                      : isPackaged === false
                        ? 'Development profile is separate from the installed profile and is preserved on uninstall.'
                        : 'Loading profile information…'}
                  </dd>
                </dl>
                <a className="secondary button-link" href="#/activity">Open activity and diagnostics</a>
              </section>
            </section>
          ) : null}
        </main>

      </div>
    </div>
  );
}
