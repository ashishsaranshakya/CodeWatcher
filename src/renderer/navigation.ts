export type AppPage = 'overview' | 'jobs' | 'activity' | 'settings' | 'not-found';

export interface AppRoute {
  page: AppPage;
  jobId?: string;
}

export const navigationItems: { page: Exclude<AppPage, 'not-found'>; label: string }[] = [
  { page: 'overview', label: 'Overview' },
  { page: 'jobs', label: 'Mirror jobs' },
  { page: 'activity', label: 'Activity' },
  { page: 'settings', label: 'Settings' },
];

export function routeFromHash(hash: string): AppRoute {
  if (!hash || hash === '#/' || hash === '#') return { page: 'overview' };

  const segments = hash.slice(2).split('/');
  if (segments.length === 1) {
    const item = navigationItems.find((candidate) => candidate.page === segments[0]);
    if (item) return { page: item.page };
  }
  if (segments.length === 2 && segments[0] === 'jobs' && segments[1]) {
    try {
      return { page: 'jobs', jobId: decodeURIComponent(segments[1]) };
    } catch {
      return { page: 'not-found' };
    }
  }
  return { page: 'not-found' };
}

export function jobRoute(jobId: string): string {
  return `#/jobs/${encodeURIComponent(jobId)}`;
}
