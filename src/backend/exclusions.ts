import type { ExclusionRule } from '../shared/jobs.ts';

export const DEFAULT_EXCLUSIONS: readonly ExclusionRule[] = [
  ...[
    '.git',
    'node_modules',
    'venv',
    '.venv',
    '__pycache__',
    '.vite',
    '.gradle',
    '.idea',
    '.next',
    '.nuxt',
    'coverage',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.tox',
    '.eggs',
  ].map((pattern) => ({
    type: 'directory_name' as const,
    pattern,
    enabled: true,
    origin: 'default' as const,
  })),
  {
    type: 'directory_pattern',
    pattern: '*.egg-info',
    enabled: true,
    origin: 'default',
  },
  ...['*.log', '*.tmp', '*.temp', '*.cache', '*.pyc', '*.pyo', '*.class'].map(
    (pattern) => ({
      type: 'file_pattern' as const,
      pattern,
      enabled: true,
      origin: 'default' as const,
    }),
  ),
];

export const SENSITIVE_FILE_PRESET: readonly ExclusionRule[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
].map((pattern) => ({
  type: 'file_pattern',
  pattern,
  enabled: true,
  origin: 'preset',
}));

export const TECHNOLOGY_PRESETS: Readonly<Record<string, readonly ExclusionRule[]>> = {
  java: ['target', '.gradle', 'build', '*.class'].map((pattern) => ({
    type: pattern.startsWith('*.') ? 'file_pattern' : 'directory_name',
    pattern,
    enabled: true,
    origin: 'preset',
  })),
  node: ['node_modules', '.npm', '.yarn/cache', '.pnpm-store'].map((pattern) => ({
    type: pattern.includes('/') ? 'relative_path' : 'directory_name',
    pattern,
    enabled: true,
    origin: 'preset',
  })),
  python: ['venv', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'].map(
    (pattern) => ({
      type: 'directory_name',
      pattern,
      enabled: true,
      origin: 'preset',
    }),
  ),
  frontend: ['.vite', '.next', '.nuxt', 'coverage', 'build', 'dist'].map((pattern) => ({
    type: 'directory_name',
    pattern,
    enabled: true,
    origin: 'preset',
  })),
};

function globToRegExp(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        index += 1;
        if (pattern[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'iu');
}

function normalizedRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
}

function matchesPattern(value: string, pattern: string): boolean {
  return globToRegExp(normalizedRelativePath(pattern)).test(normalizedRelativePath(value));
}

function matchesRelativePath(value: string, pattern: string): boolean {
  const normalizedValue = normalizedRelativePath(value);
  const normalizedPattern = normalizedRelativePath(pattern);
  if (normalizedPattern.endsWith('/**')) {
    const directory = normalizedPattern.slice(0, -3).replace(/\/+$/, '');
    return normalizedValue === directory || normalizedValue.startsWith(`${directory}/`);
  }
  return matchesPattern(normalizedValue, normalizedPattern);
}

function matchesDirectoryPattern(relativePath: string, pattern: string): boolean {
  const normalizedPath = normalizedRelativePath(relativePath);
  const normalizedPattern = normalizedRelativePath(pattern).replace(/\/\*\*$/, '');
  const segments = normalizedPath.split('/');
  return segments.some((_, index) =>
    matchesPattern(segments.slice(0, index + 1).join('/'), normalizedPattern),
  );
}

function isWithinExcludedDirectory(
  relativePath: string,
  isDirectory: boolean,
  rule: ExclusionRule,
): boolean {
  const segments = normalizedRelativePath(relativePath).split('/');
  const directorySegments = isDirectory ? segments : segments.slice(0, -1);
  if (rule.type === 'directory_name') {
    return directorySegments.includes(normalizedRelativePath(rule.pattern));
  }
  if (rule.type === 'directory_pattern') {
    return directorySegments.some((_, index) =>
      matchesDirectoryPattern(directorySegments.slice(0, index + 1).join('/'), rule.pattern),
    );
  }
  return false;
}

function isSensitiveSample(relativePath: string): boolean {
  const basename = relativePath.split('/').at(-1)?.toLowerCase();
  return basename !== undefined && /^\.env\.(example|sample|template)$/.test(basename);
}

export function isExcluded(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly ExclusionRule[] = [],
): boolean {
  const normalizedPath = normalizedRelativePath(relativePath);
  const segments = normalizedPath.split('/');
  const basename = segments.at(-1) ?? '';
  const allRules = [...DEFAULT_EXCLUSIONS, ...rules].filter((rule) => rule.enabled);
  return allRules.some((rule) => {
    const pattern = normalizedRelativePath(rule.pattern);
    switch (rule.type) {
      case 'directory_name':
        return isWithinExcludedDirectory(relativePath, isDirectory, rule);
      case 'directory_pattern':
        return isWithinExcludedDirectory(relativePath, isDirectory, rule);
      case 'file_pattern':
        if (
          rule.origin === 'preset' &&
          isSensitiveSample(relativePath)
        ) {
          return false;
        }
        return !isDirectory && matchesPattern(basename, pattern);
      case 'relative_path':
        return matchesRelativePath(normalizedPath, pattern);
    }
  });
}

export function validateExclusionRule(rule: ExclusionRule): string | undefined {
  const pattern = rule.pattern.trim();
  if (!pattern) return 'An exclusion pattern cannot be empty.';
  if (pattern.length > 260) return 'Exclusion patterns must be 260 characters or fewer.';
  if (pattern.startsWith('/') || /^[a-z]:/i.test(pattern) || pattern.includes('\0')) {
    return 'Exclusion patterns must be relative paths, not absolute paths.';
  }
  if (pattern.split(/[\\/]/).includes('..')) {
    return 'Exclusion patterns cannot traverse to a parent directory.';
  }
  return undefined;
}
