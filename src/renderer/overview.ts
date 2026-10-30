import type { MirrorJob, RunHistoryEntry, SyncOutcome } from '../shared/jobs';

export interface JobAttentionItem {
  job: MirrorJob;
  run: RunHistoryEntry;
}

export interface OverviewSummary {
  totalJobs: number;
  automatedJobs: number;
  jobsWithoutRuns: number;
  attentionJobs: JobAttentionItem[];
  recentRuns: RunHistoryEntry[];
}

const attentionOutcomes = new Set<SyncOutcome>(['warning', 'failure', 'timed_out']);

export function getOverviewSummary(
  jobs: readonly MirrorJob[],
  runHistory: readonly RunHistoryEntry[],
): OverviewSummary {
  const latestRunByJob = new Map<string, RunHistoryEntry>();
  for (const run of runHistory) {
    const current = latestRunByJob.get(run.jobId);
    if (!current || Date.parse(run.startedAt) > Date.parse(current.startedAt)) {
      latestRunByJob.set(run.jobId, run);
    }
  }

  const attentionJobs = jobs.flatMap((job) => {
    const run = latestRunByJob.get(job.id);
    return run && attentionOutcomes.has(run.outcome) ? [{ job, run }] : [];
  });

  return {
    totalJobs: jobs.length,
    automatedJobs: jobs.filter((job) => job.enabled).length,
    jobsWithoutRuns: jobs.filter((job) => !latestRunByJob.has(job.id)).length,
    attentionJobs,
    recentRuns: [...runHistory]
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
      .slice(0, 5),
  };
}
