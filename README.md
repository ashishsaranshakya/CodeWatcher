# CodeMirror

CodeMirror is a Windows desktop application for managing filtered local folder
mirrors.

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

## Activity and diagnostics

The Activity page shows the 100 most recent local mirror runs, with search,
job, result, and sort filters. Each run has a detail view with its summary,
trigger, timestamps, duration, exit code, and output-truncation status where
available. The job page also links to its recent runs. History is retained to
the newest 1,000 runs. Full Robocopy output is not retained in Activity.
Application logs are stored under the active profile's `logs` folder (for
example, `%APPDATA%\CodeMirror\dev\logs`) and rotate at 2 MB per file with
three backups. Diagnostic exports include up to 100 recent
runs and 500 log records; they omit configured paths, job names, and run/job
identifiers, and redact Windows paths from summaries and log messages. Export
is user-initiated to a location selected in the Save dialog; CodeMirror does
not upload diagnostics. These records describe local mirroring activity.

Settings shows the app version and whether the current profile is the installed
user profile or the separate development profile. Job configuration and run
history remain local to the active profile. Uninstalling the packaged app
removes its installed profile and owned scheduled task; it does not remove the
separate development profile. Diagnostics export remains available from
Activity, is initiated only by the user, and should be reviewed before sharing.

## Test process safety

Tests run serially and remain foregrounded to avoid Windows Robocopy file-lock
races. They clean up temporary databases and await any child processes before
reporting completion. Worker lifecycle tests are bounded and await worker
shutdown. The normal test suite never creates a scheduled task. To opt in to
the Windows Scheduler integration test, which creates a unique disposable
task and verifies it is removed in `finally`, run:

```powershell
$env:RUN_CODEMIRROR_SCHEDULER_INTEGRATION = '1'
npm test
```
