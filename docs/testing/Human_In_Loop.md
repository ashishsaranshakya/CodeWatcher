# CodeMirror Human-in-the-Loop Verification

This guide covers the manual checks still open in [UI_UX_PLAN.md](./UI_UX_PLAN.md)
and [PLAN.md](./PLAN.md). Record the build, Windows version, display scaling,
window size, test profile, and result for each check. Mark a check complete only
after recording its outcome and any issue found.

## Safety and preparation

You can do most checks on your only laptop. Use the development app and its
disposable sandbox folders for ordinary UI and mirror workflows. For tests
that change installed app data, create a separate local Windows account first;
a VM is optional, not required. A second account isolates per-user app data but
does not isolate system-wide changes, so do not experiment with unrelated
Windows tasks or services.

- If you do not have a separate account or VM, skip installer lifecycle,
  failure-injection, and reboot/scheduler recovery checks. Record them as
  **Not run — no isolated Windows environment** rather than risking your
  everyday profile.
- Do not use personal folders or important files as mirror sources or
  destinations. `/MIR` can overwrite changed destination files and delete
  destination-only files.
- For development testing, use disposable source and destination folders under
  `C:\Users\harsh\Desktop\CodeWatcher\sandbox`.
- Use a dedicated test profile and clearly named test jobs. Do not edit, remove,
  or disable unrelated Windows scheduled tasks.
- Start the app and any test command in the foreground. Wait for it to exit
  before proceeding; do not leave test scripts, workers, or app processes
  running in the background.
- Before enabling automation, note that you did so. Disable it after the check
  and verify the CodeMirror-owned test task is gone. Inspect running processes
  for CodeMirror, Electron, Robocopy, and test-owned Node processes. Stop only
  processes confirmed to belong to this test.
- Keep a note of failures and screenshots/logs that do not contain personal
  paths or other private data.

### Optional: make a separate local Windows test account

1. In Windows Settings, open **Accounts** and add a local user. Use a standard
   (non-administrator) account unless a particular test specifically requires
   otherwise.
2. Sign into that account once so Windows creates its profile. Do not copy
   personal files or credentials into it.
3. Use it only for packaged-app and per-user profile tests. Keep development
   tests in your normal account and inside the repository's sandbox.
4. Before signing out or rebooting, disable test automation and confirm the
   test-owned task is removed. If you cannot confirm cleanup, do not log off
   or reboot yet.
5. Remove the test account only after its app is uninstalled, its test task is
   gone, and you have saved any sanitized evidence you want to keep.

## UI and accessibility checks

### Keyboard-only operation

1. Launch the app and do not use the mouse.
2. Use `Tab` and `Shift+Tab` to move through the sidebar, page content, and
   actions. Confirm focus is visible and follows a logical order.
3. Use `Enter` on links and `Space`/`Enter` on buttons. Visit Overview, Mirror
   jobs, Activity, and Settings, then return using the app navigation.
4. Create a test job using only the keyboard. Move through every step and field;
   verify validation errors are announced/visible and focus can reach the
   invalid field.
5. In job details, operate section links, exclusion controls, automation
   controls, preview, and mirror actions using the keyboard.
6. Open and dismiss the in-app remove confirmation without removing the test
   job. Check that the dialog/action group can be entered, operated, and exited
   by keyboard.
7. In Activity, operate search, filters, sorting, run links, refresh, and
   diagnostics export. Cancel the save dialog using the keyboard.
8. Pass when every interactive control is reachable, its focus is visible,
   activation works, and there is no keyboard trap.

### Job-detail subsection navigation

1. Open a test job with all four sections available.
2. Click Overview, Folders & exclusions, Automation, and Runs one at a time.
   Confirm each click scrolls to the corresponding section and leaves the
   section heading visible below the sticky navigation.
3. Scroll slowly down through the page. Confirm the highlighted subsection
   changes when each new section becomes current.
4. Scroll upward and confirm the highlight changes back in the opposite order.
5. Click a subsection while positioned elsewhere. Confirm the click still
   completes its scroll and the highlight settles on the destination section.
6. Scroll to the bottom of the page and confirm Runs becomes active even when
   its section is too short to reach the normal activation line.
7. Repeat after resizing the window. Pass when the highlight always reflects
   the visible section and the links remain usable.

### Visual states and real paths

1. With disposable folders, inspect the jobs list and job-detail page before a
   run. Confirm a job with no run history is not presented as a successful run.
2. Run a successful preview and inspect the preview panel, including its
   read-only status, file/deletion summary, and close action.
3. Run a mirror only against disposable data. Inspect the completed result and
   the corresponding Activity entry.
4. To inspect an error state, create a test job, then make its disposable source
   unavailable before running it. Restore the folder afterward. Confirm the
   error is associated with that job and is understandable.
5. Inspect disabled, enabled, running, cancelling, warning, failed, and
   successful states where they can be reached safely. Do not manufacture
   states by editing production data.
6. Create a test job with a long but valid name and deeply nested disposable
   source/destination paths. Confirm paths can be read or expanded and do not
   cover actions or force the page wider than the window.
7. Pass when state labels and actions are clear, paths remain usable, and no
   job displays another job's feedback.

### Long and unusual content

1. Use a disposable profile/data set containing long job names, deep Windows
   paths, long run summaries, and long error text.
2. Check both the empty state and populated states for jobs, runs, exclusions,
   and search/filter results.
3. Check a large Activity history (up to the supported 100 visible entries).
   Search and filter it, open a run, and return to Activity.
4. Check any localized or unusually long text available in the test
   environment. Confirm labels wrap or truncate accessibly rather than
   overlapping controls.
5. Pass when content remains readable, interactive controls remain reachable,
   and there is no document-level horizontal overflow.

### Window size and Windows display scaling

1. Set the app window to the supported minimum size, 760 × 560 logical pixels.
2. Visit Overview, Mirror jobs, job details, job creation, Activity, run
   details, and Settings. Check headings, primary actions, tables, dialogs,
   and sticky subsection navigation.
3. Resize the window narrower/wider and shorter/taller. Confirm navigation
   adapts and no essential action becomes clipped or inaccessible.
4. Repeat at common Windows display scaling settings available on the test
   machine (for example 100%, 125%, 150%, and 200%). Restart the app after
   changing scaling if Windows requires it.
5. Pass when the minimum-size layout remains usable and there is no clipped
   essential content or unintended horizontal scrolling.

### Windows conventions and dialogs

1. Exercise folder selection, diagnostics Save, and destructive job removal.
2. Confirm native dialogs are used only where appropriate (folder/file
   selection), while important app guidance, review, and destructive
   confirmation remain clear in the app UI.
3. Check cancel and close behavior for every dialog. Confirm cancelling does
   not create a job, start a mirror, or export a file.
4. Pass when dialogs use expected Windows behavior and do not replace core
   workflow guidance.

## End-to-end workflows

Run these checks first in development using disposable folders. Compare with
the already available packaged build if present. For packaged profile tests,
prefer the optional separate Windows account. Do not rebuild or reinstall the
executable as part of this guide unless that work is explicitly authorized.

### First launch and create/restart persistence

1. Start the app in the selected test profile and confirm the initial page,
   loading state, and empty-workspace guidance are correct.
2. Create one test job with automation disabled. Confirm it appears in Mirror
   jobs and its source/destination are correct.
3. Close the app normally and wait for it to exit.
4. Start it again using the same profile. Confirm the job remains listed and
   its configuration is intact.
5. Confirm the development profile and installed profile remain distinct;
   development testing must not change installed user data.

### Preview and manual mirror

1. Populate a disposable source with a few files and a disposable destination
   with one matching file plus one destination-only file.
2. Run Preview. Confirm the destination is unchanged, the matching file and
   destination-only file are reported appropriately, and the preview clearly
   remains read-only.
3. Verify overwrite behavior only using a disposable matching file whose
   content differs between source and destination.
4. Run Mirror now only after confirming both paths are disposable. Confirm the
   destination matches the expected mirror, including the destination-only
   deletion and changed-file overwrite.
5. Confirm the result appears in Activity with the expected trigger, outcome,
   duration/exit information where available, and summary.
6. Close the app normally and verify it and its test-owned child processes exit.

### Automatic mirroring

1. Use a disposable job and test profile. Confirm automation is initially off.
2. Enable automation. Confirm the UI reports the state and a CodeMirror-owned
   task for this test profile is registered.
3. Make a harmless change in the disposable source and wait for the configured
   debounce period. Confirm a run is recorded and the destination is updated.
4. Disable automation. Confirm the UI reports it off and, when this was the
   last enabled job for the profile, the matching owned task is removed.
5. Confirm no unrelated scheduled task was changed.

### Activity and diagnostics

1. Open Activity and verify recent test runs appear with usable search, job,
   result, and sort filters.
2. Open a run detail and verify its job, trigger, timestamps, outcome,
   duration, exit code, and output-truncation information where available.
3. Return to Activity and refresh history. Confirm errors are visible if a
   refresh fails; do not interpret an error as an empty history.
4. Export diagnostics to a disposable location. Inspect the export for expected
   run/log data and confirm configured paths, job names, identifiers, and
   Windows paths are omitted or redacted as documented.
5. Delete the exported test file during cleanup if it is no longer needed.

### Development versus packaged copy

1. Compare the same workflow screens in development and the existing packaged
   build: first launch, jobs, job details, preview/result, Activity, Settings,
   and diagnostics.
2. Confirm differences are limited to behavior that legitimately varies by
   runtime, such as sandbox restrictions and profile identification.
3. Confirm no development-only sandbox message appears in the packaged app and
   no production-only claim is made by development UI.
4. Record the packaged build version used; do not assume an old package
   includes the latest source changes.

## Worker and recovery checks

These can be done on the same laptop, but use the optional separate Windows
account and disposable folders. Save your work first. Do not enable a test
logon task in your everyday account if you are unsure how to verify its
cleanup.

### Logoff, reboot, and resume recovery

1. Create a disposable job, enable automation, and confirm the matching
   CodeMirror-owned logon task is registered.
2. Confirm an initial run completes and the test source/destination are
   consistent.
3. Disable automation and verify the test task is removed before signing out.
   Then enable it again in the test account, sign out, and sign back into that
   account. Confirm the worker/task starts as
   expected, runs or resumes its startup reconciliation, and records the
   result.
4. Before rebooting, disable automation and confirm the test task is removed.
   Re-enable it only when ready to test; after sign-in, confirm startup
   reconciliation and history, then disable it and verify cleanup again.
5. For sleep/resume, use a disposable source change and confirm the watcher or
   reconciliation updates the destination and history after resume.
6. Do not sign out, reboot, or close the laptop while unsure whether a
   test-owned task or worker is active. If cleanup is uncertain, stop here and
   record the check as not run.

### Partial database or scheduler failure recovery

1. Do not manually corrupt or lock a database, edit scheduler internals, or
   inject failures into your everyday profile.
2. If the project provides an explicit automated fault-injection test, run
   that test in the foreground and follow its cleanup instructions.
3. Otherwise, defer this check until there is a disposable Windows account or
   VM and a documented safe fault-injection procedure. Mark it **Not run**;
   this is not a normal UI test.

## Installer and release checks

These are the riskiest checks. Prefer a VM snapshot. A separate local Windows
account is a fallback for per-user install tests, but it is not a full system
snapshot. If neither isolation option is available, defer the tests and mark
them **Not run**. Do not uninstall or roll back the app in your everyday
account just to satisfy the checklist.

### Clean install, upgrade, rollback, and uninstall

1. In the separate test account, install the existing release artifact only if
   its installer is clearly per-user and does not require changing system-wide
   settings. Otherwise use a VM or defer. Launch it and confirm the app opens
   with the expected profile and version.
2. Create a disposable job and enable automation. Record the profile-specific
   data location and owned task identity.
3. Install an approved newer build over the test install. Confirm the app
   starts, the version updates, the test profile remains intact, and no
   duplicate or unrelated task is created.
4. Test rollback using the documented release procedure and a snapshot or
   disposable profile. Confirm profile/task ownership remains scoped to the
   test install and document any unsupported downgrade behavior.
5. Uninstall only the test-account app. Confirm only the matching installed profile and
   CodeMirror-owned task are removed as documented; development data and
   unrelated files/tasks remain untouched.
6. Reboot or sign in again if required to confirm no test worker or startup
   task remains.

### Windows integration, performance, security, and process-leak acceptance

1. Run the documented Windows integration checks against the test build and
   disposable folders. Confirm expected path validation, Robocopy outcomes,
   cancellation, worker shutdown, and scheduler cleanup.
2. Exercise representative small and large test trees. Record file count,
   approximate total size, elapsed time, memory/CPU observations, and any UI
   stalls. Compare against the project's expected behavior; report regressions
   rather than inventing a pass threshold.
3. Check the app's own IPC and path-validation boundaries with invalid,
   overlapping, inaccessible, and out-of-sandbox paths where applicable.
   Restrict all security testing to this application and its disposable
   environment.
4. Before and after each scenario, inspect for test-owned Electron/CodeMirror,
   Robocopy, Node, worker, and scheduler activity. Wait for normal shutdown
   first; clean up only confirmed test-owned processes/tasks.
5. Pass when checks complete without unexpected data changes, cross-profile
   effects, unhandled failures, or test-owned processes/tasks left behind.

## Final release record

For each section, record **Pass**, **Fail**, or **Not run**, plus the build and
environment used. Attach only sanitized evidence. Keep failed or unrun items
open in the plans; a source-level or automated check does not substitute for
the manual acceptance described here.
