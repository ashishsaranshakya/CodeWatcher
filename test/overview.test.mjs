import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getOverviewSummary } from '../src/renderer/overview.ts';

function job(id, enabled = false) {
  return {
    id,
    name: `Job ${id}`,
    sourcePath: `C:\\source\\${id}`,
    destinationPath: `C:\\destination\\${id}`,
    enabled,
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    exclusions: [],
  };
}

function run(jobId, outcome, startedAt) {
  return {
    runId: `${jobId}-${startedAt}`,
    jobId,
    jobName: `Job ${jobId}`,
    trigger: 'manual',
    outcome,
    startedAt,
    finishedAt: startedAt,
    exitCode: 0,
    durationMs: 1000,
    summary: '',
    outputTruncated: false,
  };
}

describe('overview summaries', () => {
  it('summarizes job and automation totals without inventing activity', () => {
    assert.deepEqual(getOverviewSummary([job('one', true), job('two')], []), {
      totalJobs: 2,
      automatedJobs: 1,
      jobsWithoutRuns: 2,
      attentionJobs: [],
      recentRuns: [],
    });
  });

  it('uses the latest run per current job to identify attention-needed jobs', () => {
    const jobs = [job('failed'), job('recovered'), job('cancelled')];
    const history = [
      run('failed', 'failure', '2026-10-30T12:00:00.000Z'),
      run('failed', 'success', '2026-10-30T11:00:00.000Z'),
      run('recovered', 'success', '2026-10-30T13:00:00.000Z'),
      run('recovered', 'timed_out', '2026-10-30T10:00:00.000Z'),
      run('cancelled', 'cancelled', '2026-10-30T14:00:00.000Z'),
      run('removed', 'failure', '2026-10-30T15:00:00.000Z'),
    ];

    const summary = getOverviewSummary(jobs, history);
    assert.deepEqual(summary.attentionJobs.map(({ job: item }) => item.id), ['failed']);
    assert.equal(summary.jobsWithoutRuns, 0);
    assert.deepEqual(
      summary.recentRuns.map(({ runId }) => runId),
      [
        'removed-2026-10-30T15:00:00.000Z',
        'cancelled-2026-10-30T14:00:00.000Z',
        'recovered-2026-10-30T13:00:00.000Z',
        'failed-2026-10-30T12:00:00.000Z',
        'failed-2026-10-30T11:00:00.000Z',
      ],
    );
  });

  it('includes latest warnings and timeouts in attention status', () => {
    const summary = getOverviewSummary(
      [job('warning'), job('timeout')],
      [
        run('warning', 'warning', '2026-10-30T10:00:00.000Z'),
        run('timeout', 'timed_out', '2026-10-30T11:00:00.000Z'),
      ],
    );
    assert.deepEqual(summary.attentionJobs.map(({ job: item }) => item.id), ['warning', 'timeout']);
  });
});
