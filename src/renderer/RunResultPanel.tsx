import type { RunHistoryEntry, SyncRunResult } from '../shared/jobs';
import { formatRunDuration } from './activity';
import { runRoute } from './navigation';

interface Props {
  result: SyncRunResult | RunHistoryEntry;
  outcomeLabel: string;
}

export default function RunResultPanel({ result, outcomeLabel }: Props) {
  return (
    <section
      className={`run-result-panel outcome-${result.outcome}`}
      aria-labelledby={`run-result-${result.runId}`}
      aria-live={result.outcome === 'failure' || result.outcome === 'timed_out' ? 'assertive' : 'polite'}
    >
      <div className="run-result-heading">
        <div>
          <span className="eyebrow">MIRROR RESULT</span>
          <h3 id={`run-result-${result.runId}`}>{outcomeLabel}</h3>
        </div>
        <span className={`run-outcome outcome-${result.outcome}`}>{outcomeLabel}</span>
      </div>
      <p>{result.summary}</p>
      <dl className="run-result-metadata">
        <dt>Duration</dt><dd>{formatRunDuration(result.durationMs)}</dd>
        <dt>Finished</dt>
        <dd>{result.finishedAt ? new Date(result.finishedAt).toLocaleString() : 'Not recorded'}</dd>
        {result.exitCode !== null && (
          <><dt>Robocopy exit code</dt><dd>{result.exitCode}</dd></>
        )}
      </dl>
      {result.outputTruncated && (
        <p className="warning-note">
          Some Robocopy output was truncated; Activity retains the run summary and exit code, not the full output.
        </p>
      )}
      {result.outcome === 'failure' || result.outcome === 'warning' || result.outcome === 'timed_out' ? (
        <p className="form-note">
          The destination may contain partial changes. Review the folders before retrying.
        </p>
      ) : result.outcome === 'cancelled' ? (
        <p className="form-note">Cancellation stops further work; destination changes already made are not rolled back.</p>
      ) : null}
      <a className="run-result-link" href={runRoute(result.runId)}>View this run in Activity</a>
    </section>
  );
}
