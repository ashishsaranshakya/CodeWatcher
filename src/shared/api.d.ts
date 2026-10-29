import type { CreateJobInput, ExclusionRule, MirrorJob, SyncPreview, SyncRunResult } from './jobs';

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CodeMirrorApi {
  getVersion(): Promise<string>;
  validatePaths(source: string, destination: string): Promise<PathValidationResult>;
  listJobs(): Promise<MirrorJob[]>;
  createJob(input: CreateJobInput): Promise<MirrorJob>;
  deleteJob(jobId: string): Promise<void>;
  updateExclusions(jobId: string, rules: ExclusionRule[]): Promise<ExclusionRule[]>;
  previewJob(jobId: string): Promise<SyncPreview>;
  copyNow(jobId: string): Promise<SyncRunResult>;
  cancelCopy(jobId: string): Promise<boolean>;
  selectFolder(): Promise<string | null>;
}

declare global {
  interface Window {
    codeMirror: CodeMirrorApi;
  }
}
