# CodeMirror

CodeMirror is a Windows desktop application for managing filtered local folder
mirrors. Google Drive for desktop, when used, is responsible for uploading the
destination; a successful local mirror does not confirm cloud upload completion.

## Development

Requirements: Windows, Node.js, and npm.

```powershell
npm install
npm test
npm run typecheck
npm start
```

`npm start` starts the foreground desktop app. Development data is stored in
`%APPDATA%\CodeMirror\dev\`, while installed builds use
`%APPDATA%\CodeMirror\<Windows-username>\`. Each profile has its own database,
logs, Electron user data, run locks, worker process identity, and Task Scheduler
task. Each app launch uses its profile directly; it does not migrate or copy
data from the old root-level `%APPDATA%\CodeMirror` location. Test databases
are created in a unique temporary directory and removed when each test exits.
Uninstalling the packaged app removes its username-specific profile and owned
scheduled task; the separate development profile is preserved.

For development safety, source and destination folders are hard-restricted to
`C:\Users\harsh\Desktop\CodeWatcher\sandbox`. The restriction is enforced in
the main process after resolving paths; folder selections outside that tree
are rejected. Installed builds allow valid user-selected folders outside the
development sandbox while still validating absolute paths, folder existence,
and source/destination overlap.

The current UI supports manual, foreground Robocopy mirrors (`/MIR`) and a
separate read-only preview. A mirror can overwrite matching destination files
and delete destination-only files. The **Mirror now** action runs immediately
without showing the preview or asking for confirmation. The preview reports
potential deletions and warns when they exceed 100 files or 10% of the
destination, but this threshold is informational only and never blocks a
mirror. The final product will not require deletion approval or enforce a
deletion threshold. Development mirrors require both folders to be inside the
sandbox; installed builds accept user-selected folders outside it.

Jobs are created with automation disabled. Enabling automatic mirroring
registers a profile-specific CodeMirror-owned Windows Task Scheduler logon
task (for example, `CodeMirror-dev-Background-Worker`) and launches a
headless worker with an explicit `--profile` argument. The worker mirrors
enabled jobs at startup, watches source folders recursively, coalesces changes
after 10 seconds of quiet (with a
60-second maximum wait), retries failures after 5, 15, and 60 seconds, and
performs a full reconciliation daily. If a watcher is unavailable, daily
reconciliation remains the backstop. The worker uses cross-process locks to
prevent duplicate job runs and exits after 30 seconds with no enabled jobs.
Disabling the last automatic job removes the owned scheduled task. Automatic
and manual mirrors both use `/MIR`; enabling automation does not add a
deletion prompt or deletion-threshold block.

## Run history and diagnostics

The app shows recent local mirror runs, including their trigger, result,
duration, and summary. History is retained to the newest 1,000 runs. Structured
application logs are stored under the active profile's `logs` folder (for
example, `%APPDATA%\CodeMirror\dev\logs`) and rotate at 2 MB per file with
three backups. Diagnostic exports include up to 100 recent
runs and 500 log records; they omit configured paths, job names, and run/job
identifiers, and redact Windows paths from summaries and log messages. Export
is user-initiated to a location selected in the Save dialog; CodeMirror does
not upload diagnostics. These records describe local mirroring only and do
not indicate Google Drive upload completion.

## Test process safety

Tests must remain foregrounded and clean up temporary databases and any child
processes they start before reporting completion. Worker lifecycle tests are
bounded and await worker shutdown. The normal test suite never creates a
scheduled task. To opt in to the Windows Scheduler integration test, which
creates a unique disposable task and verifies it is removed in `finally`, run:

```powershell
$env:RUN_CODEMIRROR_SCHEDULER_INTEGRATION = '1'
npm test
```
