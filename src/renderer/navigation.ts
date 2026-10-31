export type AppPage = 'overview' | 'jobs' | 'job-create' | 'activity' | 'settings' | 'not-found';
export type JobSection = 'overview' | 'folders' | 'automation' | 'runs';

export interface AppRoute {
  page: AppPage;
  jobId?: string;
  runId?: string;
  section?: JobSection;
}

export const navigationItems: { page: Exclude<AppPage, 'not-found' | 'job-create'>; label: string }[] = [
  { page: 'overview', label: 'Overview' },
  { page: 'jobs', label: 'Mirror jobs' },
  { page: 'activity', label: 'Activity' },
  { page: 'settings', label: 'Settings' },
];

const jobSections: JobSection[] = ['overview', 'folders', 'automation', 'runs'];

export function routeFromHash(hash: string): AppRoute {
  if (!hash || hash === '#/' || hash === '#') return { page: 'overview' };

  const [routePath, sectionFragment] = hash.slice(2).split('#', 2);
  const segments = routePath.split('/');
  if (segments.length === 1) {
    const item = navigationItems.find((candidate) => candidate.page === segments[0]);
    if (item) return { page: item.page };
  }
  if (segments.length === 2 && segments[0] === 'jobs' && segments[1] === 'new') {
    return { page: 'job-create' };
  }
  if (segments.length === 2 && segments[0] === 'activity' && segments[1]) {
    try {
      return { page: 'activity', runId: decodeURIComponent(segments[1]) };
    } catch {
      return { page: 'not-found' };
    }
  }
  if (segments.length === 2 && segments[0] === 'jobs' && segments[1]) {
    try {
      const section = jobSections.find((candidate) => candidate === sectionFragment);
      return {
        page: 'jobs',
        jobId: decodeURIComponent(segments[1]),
        ...(section ? { section } : {}),
      };
    } catch {
      return { page: 'not-found' };
    }
  }
  return { page: 'not-found' };
}

export function jobRoute(jobId: string): string {
  return `#/jobs/${encodeURIComponent(jobId)}`;
}

export function runRoute(runId: string): string {
  return `#/activity/${encodeURIComponent(runId)}`;
}
