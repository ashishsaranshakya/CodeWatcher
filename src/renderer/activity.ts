import type { RunHistoryEntry, SyncOutcome } from '../shared/jobs';

export type RunSortOrder = 'newest' | 'oldest';

export interface ActivityFilters {
  outcome: SyncOutcome | 'all';
  jobId: string;
  query: string;
  sort: RunSortOrder;
}

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  outcome: 'all',
  jobId: 'all',
  query: '',
  sort: 'newest',
};

export function filterRunHistory(
  runs: readonly RunHistoryEntry[],
  filters: ActivityFilters,
): RunHistoryEntry[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return runs
    .filter((run) => filters.outcome === 'all' || run.outcome === filters.outcome)
    .filter((run) => filters.jobId === 'all' || run.jobId === filters.jobId)
    .filter((run) => {
      if (!query) return true;
      return `${run.jobName} ${run.summary} ${run.trigger}`.toLocaleLowerCase().includes(query);
    })
    .sort((left, right) => {
      const difference = Date.parse(left.startedAt) - Date.parse(right.startedAt);
      return filters.sort === 'newest' ? -difference : difference;
    });
}

export function formatRunDuration(durationMs: number | null): string {
  if (durationMs === null) return 'Duration unavailable';
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
