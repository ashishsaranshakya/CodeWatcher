import { contextBridge, ipcRenderer } from 'electron';
import type { CodeMirrorApi } from './shared/api';

const api: CodeMirrorApi = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getRuntimeInfo: () => ipcRenderer.invoke('app:get-runtime-info'),
  validatePaths: (source, destination) =>
    ipcRenderer.invoke('paths:validate', source, destination),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  listRunHistory: () => ipcRenderer.invoke('diagnostics:list-runs'),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  createJob: (input) => ipcRenderer.invoke('jobs:create', input),
  setJobEnabled: (jobId, enabled) => ipcRenderer.invoke('jobs:set-enabled', jobId, enabled),
  deleteJob: (jobId) => ipcRenderer.invoke('jobs:delete', jobId),
  updateExclusions: (jobId, rules) => ipcRenderer.invoke('jobs:update-exclusions', jobId, rules),
  previewJob: (jobId) => ipcRenderer.invoke('jobs:preview', jobId),
  copyNow: (jobId) => ipcRenderer.invoke('jobs:copy-now', jobId),
  cancelCopy: (jobId) => ipcRenderer.invoke('jobs:cancel-copy', jobId),
  selectFolder: () => ipcRenderer.invoke('folders:select'),
};

contextBridge.exposeInMainWorld('codeMirror', api);
