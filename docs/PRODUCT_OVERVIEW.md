# CodeMirror — Product Overview

## 1. Product summary

CodeMirror is a Windows desktop application for managing multiple filtered
local folder mirrors.

A user creates one or more mirror jobs. Each job defines a source folder, a
destination folder, and a set of exclusion rules. A job can be run manually or
opted into automatic background mirroring.

The application is intended for workflows such as mirroring software
development project folders to destinations managed by Google Drive for
desktop, without copying dependencies, generated files, build output, caches,
or other excluded content.

CodeMirror performs local filesystem operations. It does not upload files to
Google Drive itself, and its run history describes local mirror activity
rather than confirming cloud-side synchronization.

## 2. Problem and motivation

Software project directories often contain a mixture of useful source material
and content that is reproducible or unnecessary to mirror. Examples include
dependency directories, build output, caches, temporary files, and sensitive
local configuration.

A simple folder copy can include too much. A collection of scripts can perform
the copying, but managing multiple source/destination pairs, exclusions,
scheduling, failures, and run history becomes cumbersome.

CodeMirror brings these responsibilities into one Windows desktop
application:

- Configure multiple independent mirror jobs.
- Apply exclusions to each job.
- Preview potential mirror changes.
- Run a mirror immediately.
- Optionally automate mirroring in the background.
- Inspect local run history and export diagnostics.

## 3. Product goals

1. Make multiple local folder mirrors manageable from one desktop interface.
2. Give users control over what is excluded from each mirror.
3. Support both deliberate manual runs and opt-in automatic mirroring.
4. Make the difference between preview and an actual mirror clear.
5. Provide useful feedback about run outcomes and operational failures.
6. Keep application data, worker identity, logs, and scheduled-task ownership
   isolated by profile.
7. Make important filesystem behavior and risks understandable before users
   initiate mirroring.

## 4. Core concepts

### Mirror job

A mirror job is a configured relationship between one source folder and one
destination folder. It has a name, path configuration, exclusion rules,
automation state, and associated run history.

Jobs are created with automatic mirroring disabled. The user must explicitly
enable automation.

### Source and destination

The source is the folder whose contents are mirrored. The destination is the
local folder that receives the mirror operation. A destination may itself be
inside a folder managed by Google Drive for desktop.

CodeMirror validates paths, folder existence, and source/destination overlap.
Development builds impose an additional sandbox restriction; installed builds
allow valid user-selected folders outside that development sandbox.

### Exclusions

Exclusion rules determine which files and directories are omitted from the
mirror. The interface separates built-in exclusions, technology presets,
sensitive-file presets, and custom rules.

The current implementation uses Windows-aware matching, including
case-insensitive behavior and handling for directory, file, and path rules.

### Preview

Preview is a read-only dry run. It reports potential changes and deletion
counts without starting Robocopy or changing files.

Preview is informational. It does not approve, gate, or block a subsequent
mirror operation. Its deletion counts do not include the post-run cleanup of
destination items covered by exclusions.

### Manual mirror

**Mirror now** starts a foreground Robocopy `/MIR` operation immediately. It
does not automatically open Preview and does not ask for a deletion
confirmation.

### Automatic mirroring

Automatic mirroring is optional and enabled per job. Enabling it registers a
profile-specific CodeMirror-owned Windows Task Scheduler logon task and starts
a headless worker for that profile.

The worker mirrors enabled jobs at startup, watches source folders, coalesces
changes, retries failures, and performs daily full reconciliation.

## 5. Main user workflows

### Create a mirror job

1. Open Mirror jobs and start the job-creation flow.
2. Enter a job name.
3. Select or enter the source folder.
4. Select or enter the destination folder.
5. Review validation feedback and the job summary.
6. Save the job.

A new job is saved with automatic mirroring disabled.

### Configure exclusions

1. Open the job details.
2. Navigate to Folders & exclusions.
3. Review built-in and available preset rules.
4. Enable or disable the rules needed for the job.
5. Add custom rules where required.

### Preview a mirror

1. Open the job.
2. Choose Preview.
3. Review the read-only summary and potential deletion warnings.
4. Close the preview without changing either folder.

### Run a manual mirror

1. Confirm that the source and destination are the intended folders.
2. Review the `/MIR` behavior and its consequences.
3. Choose Mirror now.
4. Observe the foreground run and its result.
5. Review the associated Activity record if needed.

### Enable automatic mirroring

1. Open the job's Automation section.
2. Review the worker behavior and `/MIR` implications.
3. Enable automatic mirroring.
4. CodeMirror registers the profile-specific scheduled logon task and launches
   the headless worker.
5. Disable automation when it is no longer required. Disabling the last
   automatically mirrored job removes the owned scheduled task.

### Inspect activity and diagnostics

1. Open Activity to review recent local mirror runs.
2. Search, filter, or sort the history.
3. Open a run to inspect its available summary and metadata.
4. Export diagnostics only when needed, choose the destination in the Save
   dialog, and review the export before sharing it.

## 6. Important mirroring semantics and safety

CodeMirror uses Robocopy `/MIR` for both manual and automatic mirror runs.

This has consequential behavior:

- Changed matching destination files can be overwritten.
- Destination-only files and directories can be deleted.
- After a run that is neither failed nor cancelled, matching destination items
  covered by the current built-in and job exclusions are also removed.
- The exclusion cleanup applies to manual and automatic runs.
- The preview's deletion counts do not include that post-run exclusion cleanup.

Preview warns when potential deletion counts exceed 100 files or 10% of the
destination. This threshold is informational only. It does not block mirroring.

The product intentionally does not require deletion approval or enforce a
deletion threshold. **Mirror now** starts immediately without first displaying
Preview or asking for confirmation.

Users should not test with personal or important folders. Use disposable
source and destination folders when validating behavior.

## 7. Application areas

The desktop interface is organized around four primary areas:

- **Overview:** A concise view of job count, automation state, recent activity,
  and items needing attention.
- **Mirror jobs:** The main workspace for creating, viewing, configuring,
  previewing, running, and removing jobs.
- **Activity:** Recent run history, filters, run details, and diagnostics
  export.
- **Settings:** Application version, active profile information, and support
  information.

Job details organize configuration and information into Overview, Folders &
exclusions, Automation, and Runs.

Removing a job removes its configuration from CodeMirror; it does not delete
the source or destination folders.

## 8. Background worker behavior

When automatic mirroring is enabled for a profile, CodeMirror registers an
owned Windows Task Scheduler logon task and launches a headless worker with an
explicit profile argument.

The worker:

- Mirrors enabled jobs at startup.
- Watches source folders recursively.
- Coalesces changes after 10 seconds of quiet, with a 60-second maximum wait.
- Retries failures after 5, 15, and 60 seconds.
- Performs a full reconciliation daily.
- Retains daily reconciliation as a backstop if a watcher is unavailable.
- Uses cross-process locks to prevent duplicate job runs.
- Exits after 30 seconds with no enabled jobs.

The last automatic job being disabled removes the profile's owned scheduled
task.

## 9. Local data, profiles, and diagnostics

Development data is stored under:

```text
%APPDATA%\CodeMirror\dev\
```

Installed builds use a username-specific profile:

```text
%APPDATA%\CodeMirror\<Windows-username>\
```

Each profile has its own database, logs, Electron user data, run locks, worker
process identity, and Task Scheduler task. Development and installed profiles
are separate. The application does not migrate or copy data from the old
root-level `%APPDATA%\CodeMirror` location.

Uninstalling the packaged app removes its username-specific installed profile
and owned scheduled task. It preserves the separate development profile.

Activity displays the 100 most recent runs; history is retained to the newest
1,000 runs. Full Robocopy output is not retained in Activity.

Logs are stored in the active profile's `logs` folder and rotate at 2 MB per
file with three backups. User-initiated diagnostic exports include up to 100
recent runs and 500 log records. They omit configured paths, job names, and
run/job identifiers, and redact Windows paths from summaries and log messages.
CodeMirror does not upload diagnostics.

## 10. Development and testing constraints

Development builds restrict source and destination folders to:

```text
C:\Users\harsh\Desktop\CodeWatcher\sandbox
```

The Electron main process enforces this restriction after resolving paths.
Installed builds permit valid selected folders outside the development
sandbox, while still validating absolute paths, folder existence, and
source/destination overlap.

Tests run serially and in the foreground to avoid Windows Robocopy file-lock
races. Test databases use unique temporary directories and are removed when
tests exit. Worker lifecycle tests are bounded and await shutdown. The normal
test suite does not create scheduled tasks.

The optional Windows Scheduler integration test creates a unique disposable
task and verifies cleanup in `finally`.

See the repository README for commands and the exact opt-in environment
variable.

## 11. Scope and non-goals

CodeMirror is a local folder-mirroring manager. Its current scope is not to:

- Act as a cloud storage client or upload directly to Google Drive.
- Confirm that Google Drive has completed its cloud synchronization.
- Provide version history or restore overwritten/deleted destination files.
- Add a deletion-approval workflow or enforce a deletion-count threshold.
- Retain full raw Robocopy output in Activity.

These boundaries are important when describing what the product guarantees.

## 12. Supporting documentation

- [README](../README.md) — setup, development commands, operational details,
  safety notes, and documentation index.
- [AI-assisted development](development/AI_ASSISTED_DEVELOPMENT.md) — the
  first-person account of how the product was developed largely independently
  with AI as the primary collaborator.
- [Implementation plan](development/PLAN.md) — engineering phases, tasks,
  verification, and remaining acceptance work.
- [UI/UX implementation plan](development/UI_UX_PLAN.md) — interface design,
  workflows, UX decisions, and validation status.
- [Human-in-the-loop verification](testing/Human_In_Loop.md) — manual testing,
  safety, accessibility, recovery, and release checks.
