# CodeMirror

CodeMirror is a Windows desktop application for managing multiple filtered local
folder mirrors. It lets you define source-to-destination jobs, exclude files and
directories, preview potential changes, run mirrors manually, and optionally
keep destinations updated in the background.

It is designed for workflows such as mirroring software development folders to
a destination managed by Google Drive for desktop, while excluding dependencies,
generated files, build output, caches, and other content that should not be
copied.

> **Important:** CodeMirror uses Robocopy `/MIR`. A mirror can overwrite matching
> destination files and delete destination-only files. Read
> [Mirroring behavior and safety](#mirroring-behavior-and-safety) before running
> it against important data.

## Features

- **Multiple mirror jobs:** Manage independent source and destination folder
  pairs from one desktop application.
- **Folder validation:** Validate absolute paths, folder existence, source and
  destination overlap, and conflicts with existing jobs.
- **Exclusions:** Use built-in exclusions, technology presets, sensitive-file
  presets, and custom rules.
- **Read-only preview:** Inspect potential changes and deletion counts without
  starting Robocopy or modifying files.
- **Manual mirroring:** Run a foreground mirror with progress, cancellation,
  and a result summary.
- **Automatic mirroring:** Opt in per job to background mirroring through a
  profile-specific Windows Task Scheduler logon task and headless worker.
- **Activity:** Review recent local mirror runs, filter and sort history, and
  inspect run details.
- **Diagnostics:** Export a user-selected diagnostic bundle with path and
  identifier redaction.

For the product's goals, workflows, behavior, and scope, see
[Product overview](docs/PRODUCT_OVERVIEW.md).

## Mirroring behavior and safety

Manual and automatic mirror runs use Robocopy `/MIR`.

- Matching destination files can be overwritten when their source counterparts
  differ.
- Destination-only files and directories can be deleted.
- After a run that is neither failed nor cancelled, matching destination items
  covered by the current built-in and job exclusions are also removed. This
  exclusion cleanup applies to both manual and automatic runs.
- The **Mirror now** action starts immediately. It does not automatically show
  the preview or ask for confirmation.
- Preview is read-only. It reports potential deletions and warns when they
  exceed 100 files or 10% of the destination. This threshold is informational
  only and does not block a mirror.
- Preview deletion counts do not include the post-run cleanup of destination
  items covered by exclusions.
- The product does not require deletion approval or enforce a deletion
  threshold.

Use disposable folders when testing. Do not use personal or important folders
as test sources or destinations.

## Automatic mirroring

Jobs are created with automation disabled. Enabling automatic mirroring
registers a CodeMirror-owned Windows Task Scheduler logon task for the active
profile (for example, `CodeMirror-dev-Background-Worker`) and launches a
headless worker with an explicit `--profile` argument.

The worker:

- Mirrors enabled jobs at startup.
- Watches source folders recursively.
- Coalesces changes after 10 seconds of quiet, with a 60-second maximum wait.
- Retries failures after 5, 15, and 60 seconds.
- Performs a full reconciliation daily.
- Uses daily reconciliation as a backstop if a filesystem watcher is
  unavailable.
- Uses cross-process locks to prevent duplicate job runs.
- Exits after 30 seconds with no enabled jobs.

Disabling the last automatically mirrored job removes the owned scheduled task.
Automatic and manual runs both use `/MIR`; enabling automation does not add a
deletion prompt or deletion-threshold block.

## Activity and diagnostics

The Activity page displays the 100 most recent local mirror runs. It supports
search, job, result, and sort filters. A run detail can show its summary,
trigger, timestamps, duration, exit code, and output-truncation status where
available. The job page also links to recent runs.

History is retained to the newest 1,000 runs. Full Robocopy output is not
retained in Activity.

Application logs are stored under the active profile's `logs` folder (for
example, `%APPDATA%\CodeMirror\dev\logs`). Logs rotate at 2 MB per file with
three backups.

Diagnostic exports include up to 100 recent runs and 500 log records. They
omit configured paths, job names, and run/job identifiers, and redact Windows
paths from summaries and log messages. Export is initiated by the user through
a Save dialog. CodeMirror does not upload diagnostics. Review an export before
sharing it.

These records describe local mirroring activity; they do not represent or
verify cloud-side synchronization by Google Drive.

## Technology

- Electron Forge
- Vite
- React
- Strict TypeScript
- SQLite
- Windows Robocopy
- Windows Task Scheduler

See [AI-assisted development](docs/development/AI_ASSISTED_DEVELOPMENT.md) for
the story of how the product was planned and built, and the supporting
implementation records.

## Development

### Requirements

- Windows
- Node.js
- npm

### Install and run

```powershell
npm install
npm test
npm run typecheck
npm start
```

`npm start` starts the foreground desktop application.

### Development sandbox

For development safety, source and destination folders are hard-restricted to:

```text
C:\Users\harsh\Desktop\CodeWatcher\sandbox
```

The restriction is enforced in the Electron main process after resolving paths.
Folder selections outside that tree are rejected.

Installed builds allow valid user-selected folders outside the development
sandbox while continuing to validate absolute paths, folder existence, and
source/destination overlap.

### Profiles and local data

Development data is stored in:

```text
%APPDATA%\CodeMirror\dev\
```

Installed builds use:

```text
%APPDATA%\CodeMirror\<Windows-username>\
```

Each profile has its own database, logs, Electron user data, run locks, worker
process identity, and Task Scheduler task.

Each app launch uses its profile directly. It does not migrate or copy data
from the old root-level `%APPDATA%\CodeMirror` location.

Uninstalling the packaged app removes its username-specific installed profile
and owned scheduled task. The separate development profile is preserved.

## Testing

Tests run serially and remain foregrounded to avoid Windows Robocopy file-lock
races. They clean up temporary databases and await child processes before
reporting completion. Worker lifecycle tests are bounded and await worker
shutdown.

The normal test suite does not create a scheduled task.

To opt in to the Windows Scheduler integration test, which creates a unique
disposable task and verifies that it is removed in `finally`, run:

```powershell
$env:RUN_CODEMIRROR_SCHEDULER_INTEGRATION = '1'
npm test
```

For manual end-to-end, accessibility, recovery, installer, and release
acceptance checks, follow
[Human-in-the-loop verification](docs/testing/Human_In_Loop.md).

## Documentation

| Document | Purpose |
|---|---|
| [Product overview](docs/PRODUCT_OVERVIEW.md) | Product purpose, users, workflows, capabilities, and behavior |
| [AI-assisted development](docs/development/AI_ASSISTED_DEVELOPMENT.md) | How I developed CodeMirror largely independently with AI as my primary collaborator |
| [Implementation plan](docs/development/PLAN.md) | Engineering phases, implementation tasks, verification, and outstanding work |
| [UI/UX implementation plan](docs/development/UI_UX_PLAN.md) | Interface structure, workflows, UX decisions, and validation |
| [Human-in-the-loop verification](docs/testing/Human_In_Loop.md) | Manual testing procedures, safety, and release acceptance |

## Current implementation and release status

The implementation records report the core application foundation, job
configuration and persistence, exclusions and preview, synchronization,
background worker and scheduling, diagnostics, and installer generation as
implemented. Automated type-checking, test-suite, and packaging results are
recorded in the plans.

Some acceptance work remains open. This includes manual end-to-end workflows,
manual accessibility and Windows scaling checks, logoff/reboot/resume and
partial database/scheduler failure recovery, and clean install/upgrade/rollback/
uninstall validation in an isolated Windows account or VM. Windows integration,
performance, security, process-leak acceptance, and final release documentation
also remain to be completed.

See the [implementation plan](docs/development/PLAN.md) and
[human testing guide](docs/testing/Human_In_Loop.md) for the detailed status.
Do not interpret a generated installer or passing automated tests as proof that
all release acceptance checks have passed.
