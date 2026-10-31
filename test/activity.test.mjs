import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_ACTIVITY_FILTERS,
  filterRunHistory,
  formatRunDuration,
} from '../src/renderer/activity.ts';

function run(runId, jobId, jobName, outcome, startedAt, summary = '') {
  return {
    runId,
    jobId,
    jobName,
    trigger: 'manual',
    outcome,
    startedAt,
    finishedAt: startedAt,
    exitCode: 0,
    durationMs: 1200,
    summary,
    outputTruncated: false,
  };
}

describe('activity helpers', () => {
  const runs = [
    run('older-failure', 'one', 'Alpha', 'failure', '2026-10-29T10:00:00.000Z', 'File access failed'),
    run('new-success', 'one', 'Alpha', 'success', '2026-10-30T10:00:00.000Z', 'Copy complete'),
    run('warning', 'two', 'Beta', 'warning', '2026-10-30T11:00:00.000Z', 'Review output'),
  ];

  it('sorts newest first by default and supports oldest-first order', () => {
    assert.deepEqual(filterRunHistory(runs, DEFAULT_ACTIVITY_FILTERS).map((runItem) => runItem.runId), [
      'warning',
      'new-success',
      'older-failure',
    ]);
    assert.deepEqual(
      filterRunHistory(runs, { ...DEFAULT_ACTIVITY_FILTERS, sort: 'oldest' }).map((runItem) => runItem.runId),
      ['older-failure', 'new-success', 'warning'],
    );
  });

  it('filters by job, outcome, and case-insensitive query and clears with default filters', () => {
    assert.deepEqual(
      filterRunHistory(runs, {
        ...DEFAULT_ACTIVITY_FILTERS,
        jobId: 'one',
        outcome: 'failure',
        query: 'ACCESS',
      }).map((runItem) => runItem.runId),
      ['older-failure'],
    );
    assert.equal(filterRunHistory(runs, DEFAULT_ACTIVITY_FILTERS).length, runs.length);
  });

  it('formats short, long, and unavailable durations', () => {
    assert.equal(formatRunDuration(21), '21 ms');
    assert.equal(formatRunDuration(1250), '1.3 s');
    assert.equal(formatRunDuration(null), 'Duration unavailable');
  });
});
