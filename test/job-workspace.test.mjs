import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getLatestRunsByJob } from '../src/renderer/job-workspace.ts';

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

describe('job workspace run summaries', () => {
  it('selects the most recent local run for each job regardless of input order', () => {
    const history = [
      run('one', 'failure', '2026-10-30T10:00:00.000Z'),
      run('two', 'success', '2026-10-30T12:00:00.000Z'),
      run('one', 'success', '2026-10-30T11:00:00.000Z'),
    ];

    const latestRuns = getLatestRunsByJob(history);
    assert.equal(latestRuns.get('one')?.outcome, 'success');
    assert.equal(latestRuns.get('two')?.outcome, 'success');
    assert.equal(latestRuns.get('missing'), undefined);
  });
});
