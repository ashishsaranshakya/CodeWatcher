import { contextBridge, ipcRenderer } from 'electron';
import type { CodeMirrorApi } from './shared/api';

const api: CodeMirrorApi = {
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  validatePaths: (source, destination) =>
    ipcRenderer.invoke('paths:validate', source, destination),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  createJob: (input) => ipcRenderer.invoke('jobs:create', input),
  deleteJob: (jobId) => ipcRenderer.invoke('jobs:delete', jobId),
  updateExclusions: (jobId, rules) => ipcRenderer.invoke('jobs:update-exclusions', jobId, rules),
  previewJob: (jobId) => ipcRenderer.invoke('jobs:preview', jobId),
  copyNow: (jobId) => ipcRenderer.invoke('jobs:copy-now', jobId),
  cancelCopy: (jobId) => ipcRenderer.invoke('jobs:cancel-copy', jobId),
  selectFolder: () => ipcRenderer.invoke('folders:select'),
};

contextBridge.exposeInMainWorld('codeMirror', api);
