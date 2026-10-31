import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { jobRoute, navigationItems, routeFromHash, runRoute } from '../src/renderer/navigation.ts';

describe('renderer navigation', () => {
  it('exposes all primary pages and uses Overview as the default route', () => {
    assert.deepEqual(
      navigationItems.map(({ page }) => page),
      ['overview', 'jobs', 'activity', 'settings'],
    );
    assert.deepEqual(routeFromHash(''), { page: 'overview' });
    assert.deepEqual(routeFromHash('#/'), { page: 'overview' });
  });

  it('resolves primary page and job-detail routes', () => {
    assert.deepEqual(routeFromHash('#/activity'), { page: 'activity' });
    assert.deepEqual(routeFromHash('#/jobs/job-123'), { page: 'jobs', jobId: 'job-123' });
    assert.deepEqual(routeFromHash('#/jobs/new'), { page: 'job-create' });
    assert.deepEqual(routeFromHash('#/jobs/job-123#automation'), {
      page: 'jobs',
      jobId: 'job-123',
      section: 'automation',
    });
  });

  it('round-trips job IDs with reserved URL characters and rejects invalid routes', () => {
    const id = 'job/with spaces?';
    assert.deepEqual(routeFromHash(jobRoute(id)), { page: 'jobs', jobId: id });
    assert.deepEqual(routeFromHash(runRoute('run/with spaces?')), {
      page: 'activity',
      runId: 'run/with spaces?',
    });
    assert.deepEqual(routeFromHash('#/unknown'), { page: 'not-found' });
    assert.deepEqual(routeFromHash('#/jobs/%E0%A4%A'), { page: 'not-found' });
    assert.deepEqual(routeFromHash('#/activity/%E0%A4%A'), { page: 'not-found' });
  });
});
