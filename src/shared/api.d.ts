import type {
  CreateJobInput,
  ExclusionRule,
  MirrorJob,
  RunHistoryEntry,
  SyncPreview,
  SyncRunResult,
} from './jobs';

export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

export interface RuntimeInfo {
  restrictToSandbox: boolean;
  isPackaged: boolean;
}

export interface CodeMirrorApi {
  getVersion(): Promise<string>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  validatePaths(source: string, destination: string): Promise<PathValidationResult>;
  listJobs(): Promise<MirrorJob[]>;
  listRunHistory(): Promise<RunHistoryEntry[]>;
  exportDiagnostics(): Promise<boolean>;
  createJob(input: CreateJobInput): Promise<MirrorJob>;
  setJobEnabled(jobId: string, enabled: boolean): Promise<MirrorJob>;
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
