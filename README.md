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

`npm start` is a foreground desktop process. Close the CodeMirror window to
exit it. The current app can create and remove disabled mirror-job
configurations. It stores settings in
`%APPDATA%\CodeMirror\codemirror.sqlite`; test databases are created in a
unique temporary directory and removed when each test exits.

For development safety, source and destination folders are hard-restricted to
`C:\Users\harsh\Desktop\CodeWatcher\sandbox`. The restriction is enforced in
the main process after resolving paths; folder selections outside that tree
are rejected. There is a TODO next to the hard-coded path to remove this
restriction for the final product.

The current UI supports manual, foreground Robocopy mirrors (`/MIR`) and a
separate read-only preview. A mirror can overwrite matching destination files
and delete destination-only files. The **Mirror now** action runs immediately
without showing the preview or asking for confirmation. The preview reports
potential deletions and warns when they exceed 100 files or 10% of the
destination, but this threshold is informational only and never blocks a
mirror. The final product will not require deletion approval or enforce a
deletion threshold. The source and
existing destination must be inside the sandbox. New jobs remain disabled for
automation, but can be run manually. Watchers, background workers, and
Windows scheduled tasks are not implemented yet, and no tasks are registered.

## Test process safety

Tests must remain foregrounded, must not create persistent Task Scheduler
entries, and must clean up temporary databases and any child processes they
start before reporting completion. Scheduler integration tests must use a
uniquely named disposable task and remove it in a `finally` cleanup path.
Until that harness exists, tests must not invoke Task Scheduler or launch
long-lived supervisor/worker processes.
