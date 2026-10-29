export interface MirrorJob {
  id: string;
  name: string;
  sourcePath: string;
  destinationPath: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  exclusions: ExclusionRule[];
}

export type ExclusionType =
  | 'directory_name'
  | 'directory_pattern'
  | 'file_pattern'
  | 'relative_path';

export type ExclusionOrigin = 'default' | 'preset' | 'job';

export interface ExclusionRule {
  id?: number;
  type: ExclusionType;
  pattern: string;
  enabled: boolean;
  origin: ExclusionOrigin;
}

export interface SyncPreview {
  sourcePath: string;
  destinationPath: string;
  sourceFileCount: number;
  destinationFileCount: number;
  wouldCopy: number;
  wouldUpdate: number;
  wouldDelete: number;
  deletionPercentage: number;
  deletionGuardTriggered: boolean;
  warnings: string[];
  sampleCopies: string[];
  sampleUpdates: string[];
  sampleDeletions: string[];
}

export type SyncOutcome = 'success' | 'warning' | 'failure' | 'cancelled' | 'timed_out';

export interface SyncRunResult {
  runId: string;
  jobId: string;
  outcome: SyncOutcome;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  summary: string;
  outputTruncated: boolean;
}

export interface CreateJobInput {
  name: string;
  sourcePath: string;
  destinationPath: string;
}
