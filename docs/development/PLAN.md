# CodeMirror implementation plan

Status key: `[x]` complete and verified, `[ ]` not complete, `[~]` in progress.

## Safety rule for development and tests

- [x] Product behavior confirmed: final `/MIR` runs intentionally overwrite changed files and delete destination-only files without deletion approval or threshold blocking.
- [x] Keep all tests foregrounded and bounded.
- [x] Keep Task Scheduler opt-in in tests; the Windows integration test uses a unique disposable task and verifies cleanup in `finally`.
- [x] Keep worker tests bounded and await shutdown; the Electron headless smoke test uses isolated user data and waits for process exit.
- [x] For bounded child-process tests, wait for process close and verify no test-owned process is left behind.

## Phase 0 — Foundation

- [x] Bootstrap Electron Forge + Vite + React + strict TypeScript.
- [x] Configure a hardened renderer/preload boundary and typed IPC.
- [x] Fix Forge entry-point names and verify the GUI opens and closes cleanly.
- [x] Add initial absolute-path and source/destination nesting checks.
- [x] Add test, type-check, and renderer-build commands.

## Phase 1 — Job configuration and persistence

- [x] Define typed job and exclusion-rule contracts.
- [x] Add SQLite v1 migration, repository, and transactional job creation/deletion.
- [x] Validate job names, source/destination paths, and conflicts against existing jobs.
- [x] Add native source/destination folder pickers and job CRUD UI.
- [x] Keep new jobs disabled by default; automatic mirroring starts only when explicitly enabled.
- [x] Add database/path-conflict tests and verify test databases are closed and removed.

## Phase 2 — Exclusions and previews

- [x] Implement transparent Windows-aware exclusion matching and editable presets.
- [x] Test directory/file/path rules, Unicode, case-insensitivity, nesting, and precedence.
- [x] Implement the Robocopy mirror argument builder and exit-code classification; manual runs use `/MIR`.
- [x] Implement a read-only dry-run preview with informational deletion counts and warnings; preview does not gate mirroring.

## Phase 3 — Synchronization

- [x] Implement bounded Robocopy child-process execution and structured result capture.
- [x] Add a foreground-only manual `/MIR` path with cancellation and bounded child cleanup.
- [x] Implement recursive source watchers, 10-second quiet-period debounce, 60-second maximum wait, bounded retries, and daily full reconciliation.
- [x] Test missing-source failure, `/MIR` overwrites, and destination-only deletion.
- [x] Hard-restrict development folder selection and copying to `C:\Users\harsh\Desktop\CodeWatcher\sandbox`; allow production users to select validated folders outside it.

## Phase 4 — Background operation and scheduling

- [x] Validate Electron headless launch, worker shutdown, Windows per-job inter-process locks, and heartbeat updates.
- [x] Implement the headless worker lifecycle, cross-process duplicate prevention, heartbeat, startup sync, idle shutdown, and retry/reconciliation behavior.
- [x] Implement owned Task Scheduler registration, state checks, startup reconciliation, and cleanup; disposable-task integration test passes.
- [ ] Test logoff/reboot/resume recovery and partial DB/scheduler failure recovery.

## Phase 5 — Diagnostics and safety hardening

- [x] Add trigger-aware run history with 1,000-run retention, structured rotating logs, path redaction, and user-initiated diagnostic export.
- [x] Keep diagnostics local unless explicitly exported; exports omit job names/IDs and configured paths and redact paths in messages.
- [x] Describe run status as local mirror activity; no deletion approval, threshold, or recovery policy is added.

## Phase 6 — Installer and release

- [x] Generate the Windows Squirrel installer artifact with the packaged Vite application.
- [x] Start directly in the profile-specific application-data directory; scope worker arguments, process locks, task names, and ownership markers to that profile without migrating another data directory.
- [x] Implement install/update/uninstall lifecycle handling that operates only on the matching profile task.
- [ ] Verify clean install, upgrade, rollback, and uninstall in a disposable Windows account or VM.
- [ ] Run Windows integration, performance, security, and process-leak acceptance checks.
- [ ] Complete the release checklist and update documentation.

## Current milestone acceptance

- [ ] Manually create a job through the UI and confirm it is listed after restarting the app.
- [x] Verify repository persistence across database close/reopen and reject unsafe/conflicting paths.
- [x] Run tests and type-check successfully with no test-owned processes or tasks left behind.

Phases 0–5 are implemented and covered by type-check, worker/Robocopy tests, diagnostics privacy/retention tests, a one-shot Electron headless smoke test, and an opt-in disposable Task Scheduler integration test. The Squirrel installer artifact is generated, and profile-specific startup/task identity is implemented and tested. Phase 4 acceptance still includes logoff/reboot and partial DB/scheduler failure-recovery checks. Actual clean install, upgrade, rollback, and uninstall acceptance requires a disposable Windows account or VM. Runs do not require preview or confirmation, and the final product will not add deletion approvals or deletion-threshold blocks. A manual GUI create/restart check remains.
