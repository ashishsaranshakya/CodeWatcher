import type { RunHistoryEntry } from '../shared/jobs';

export function getLatestRunsByJob(
  runHistory: readonly RunHistoryEntry[],
): Map<string, RunHistoryEntry> {
  const latestRuns = new Map<string, RunHistoryEntry>();
  for (const run of runHistory) {
    const current = latestRuns.get(run.jobId);
    if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) {
      latestRuns.set(run.jobId, run);
    }
  }
  return latestRuns;
}
