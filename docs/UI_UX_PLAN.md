# CodeMirror UI/UX implementation plan

Status key: `[x]` complete and verified, `[ ]` not complete, `[~]` in progress.

## Product goals and guardrails

- [x] Make the app feel like a deliberate Windows desktop product rather than a single-page prototype.
- [x] Make mirror jobs the primary workspace and keep activity, settings, and job configuration easy to find without crowding the jobs list.
- [x] Keep common actions discoverable and their results understandable.
- [x] Explain that `/MIR` can overwrite changed destination files and delete destination-only files near relevant actions.
- [x] Keep previews read-only and clearly distinct from mirror runs.
- [x] Do not add a confirmation requirement, deletion approval, or deletion-threshold block to manual or automatic mirroring.
- [x] Preserve the current local-only data model and profile-specific behavior.
- [x] Describe mirror results as local folder operations.
- [x] Preserve the development sandbox restriction while showing production-appropriate copy in packaged builds.
- [~] Keep the interface keyboard accessible, legible at supported window sizes, and resilient to long paths and job names.

## Phase 0 — UX foundation and copy

- [x] Inventory every renderer state and action: loading, empty, error, success, busy, cancellation, preview, automation, and history.
- [x] Define shared visual tokens for color, spacing, typography, borders, focus indicators, status colors, and control sizes.
- [x] Define consistent components and terminology for page headings, primary/secondary/destructive actions, status badges, inline feedback, and empty states.
- [x] Replace the development-only sandbox message in production UI with environment-aware guidance; retain accurate sandbox restrictions in development.
- [x] Review all `/MIR`, automation, and preview copy for accuracy and consistency.
- [x] Ensure errors are shown near the affected control and remain available to assistive technology.
- [x] Verify keyboard focus visibility, logical tab order, semantic headings, button names, and status announcements in the renderer source.
- [x] Establish a supported minimum window size and scaling behavior before implementing responsive layouts.

### Phase 0 acceptance

- [x] No packaged-app screen tells users that paths must be inside the development sandbox.
- [x] Mirror, preview, and automation descriptions accurately reflect existing behavior.
- [x] Shared visual and interaction conventions are documented in the implementation and used consistently.

### Phase 0 audit notes

- Initial load requests the app version, runtime sandbox policy, jobs, and run history. The renderer also has empty states for no jobs, no runs, and no custom exclusions.
- Job actions include folder selection, create, remove, preview, immediate mirror, cancellation, automation changes, exclusion edits, history refresh, and diagnostics export.
- Busy feedback is exposed for job creation, per-job mirroring, preview analysis, automation updates, history refresh, and diagnostics export. Success feedback is used for diagnostics export and completed mirror results. Failures are scoped to app load, the form, diagnostics, the relevant job, or the exclusions editor.
- The browser window minimum is 760 × 560 logical pixels. The renderer now adapts its sidebar into a compact horizontal navigation at narrower widths; detailed scaling and visual acceptance remain in Phase 9/10.
- Keyboard and accessibility checks in this phase are source-level: native controls retain keyboard behavior, focus-visible styling applies to interactive elements, job-specific actions have names, and status/error announcements use live-region semantics. Manual assistive-technology and scaling acceptance remains in Phase 10.

## Phase 1 — App shell and navigation

- [x] Replace the single top-bar page structure with a persistent desktop navigation shell.
- [x] Add primary navigation entries for Overview, Mirror jobs, Activity, and Settings.
- [x] Clearly indicate the current page and retain navigation state while moving between pages where appropriate.
- [x] Keep product identity and essential app-level context visible without using space needed by page content.
- [x] Define routing or view-state behavior for navigation, job selection, and back navigation.
- [x] Ensure browser-style navigation controls, if introduced, behave consistently with app navigation and do not lose unsaved form state unexpectedly.
- [x] Add a not-found or fallback view for invalid internal routes or view state.
- [x] Add responsive behavior for narrower windows: collapse or adapt navigation without clipping controls or forcing horizontal scrolling.

### Phase 1 acceptance

- [x] Every primary section is reachable from persistent navigation.
- [x] Current location is visually apparent and announced semantically.
- [x] Navigation works with mouse and keyboard.
- [~] App content remains usable at the supported minimum window size and common Windows display scaling.

### Phase 1 implementation notes

- Added hash-based routes for Overview, Mirror jobs, Activity, Settings, and individual job details. Native links provide keyboard support and browser back/forward navigation; app-level form state remains mounted across page changes.
- Moved the existing run-history and diagnostics surface to Activity. Selecting a job from Mirror jobs or Activity opens a focused job route; back navigation returns to the list, and a removed or invalid job route displays a not-found view.
- Added initial Overview and Settings entry pages so all navigation destinations have useful content. Overview summaries and first-run guidance remain in Phase 2; complete app settings and profile information remain in Phase 8.
- Added loading and retry feedback for workspace data so a load failure is not presented as an empty job/history state.
- The sidebar changes to a horizontal, wrapping navigation at narrower widths. Source CSS and route tests pass; manual visual validation at 760 × 560 and Windows display scaling remains outstanding.
- Automated validation for this phase: type-check, all 59 applicable tests (one skipped), and the Electron Forge packaging build passed. Manual visual validation at the minimum window size and Windows display scaling is still required.

## Phase 2 — Overview

- [x] Complete the Overview page scaffold as a concise current-state dashboard rather than duplicating the full job and activity pages.
- [x] Summarize total jobs and automation state in concise, understandable terms.
- [x] Show a small recent-activity summary with a clear route to full Activity.
- [x] Surface actionable failures or attention-needed states using the local run status.
- [x] Provide an obvious route to create a job and to the Mirror jobs page.
- [x] Define useful first-run content and a clear next step when no jobs exist.
- [x] Avoid presenting empty or unavailable metrics as successful zero-value status.

### Phase 2 acceptance

- [x] A returning user can identify whether jobs exist, whether automation is enabled, and whether anything needs attention at a glance.
- [x] A first-time user has an obvious next action.
- [x] Overview summaries link to the relevant detailed page and do not replace detailed history.

### Phase 2 implementation notes

- The Overview now shows total jobs, enabled automatic-mirroring jobs, and jobs whose latest recorded run needs review. Attention is based on each current job's most recent run; warning, failure, and timeout outcomes are surfaced, while an older failure is cleared from attention when a newer run succeeds.
- The dashboard lists the five most recent runs, links current jobs to their detail route, identifies runs belonging to removed jobs, and links to full Activity.
- The first-run state explains the source/destination job concept and offers a direct path into job creation. It avoids showing zero-value summary cards when no jobs exist.
- Jobs with no run history are identified separately so the dashboard does not present them as successfully synchronized. Workspace loading and load errors remain distinct from empty states.
- The overview describes local mirroring. No confirmation, deletion threshold, or other mirror behavior was added.
- Validation: `npm run typecheck` passed; `npm test` passed (62 passed, 1 skipped); the focused Overview/navigation tests passed (6 passed); and `npm run make` produced the Windows distributable successfully.

## Phase 3 — Mirror jobs workspace

- [x] Move job management to a dedicated Mirror jobs page.
- [x] Present jobs in a scannable list with job name, source and destination, automation state, and latest local run result.
- [x] Review search/filtering need; omit extra controls until the expected job count makes them useful.
- [x] Make the primary job action clear and consistent; keep Preview visibly separate from Mirror now.
- [x] Make long paths readable using truncation with an intentional way to reveal the full path.
- [x] Show automation state as a concise status with a separate, clearly labeled control to change it.
- [x] Explain the scheduled worker behavior and `/MIR` deletion implications at the point automation is enabled.
- [x] Provide a useful empty state and a prominent Add mirror job action.
- [x] Replace browser-native job removal confirmation with a deliberate in-app destructive-action treatment, while making clear that removing a job does not delete its folders.
- [x] Ensure running, cancelling, disabled, failed, and successful states cannot be confused.
- [x] Keep per-job errors and results associated with the relevant job instead of showing unrelated global feedback.

### Phase 3 foundation delivered with Phase 0/1

- [x] A dedicated Mirror jobs route now hosts job management.
- [x] Automation has a concise on/off status and a separate, labeled control.
- [x] The jobs empty state offers a clear create-job action.
- [x] Preview is identified as read-only and distinct from **Mirror now**.
- [x] `/MIR` overwrite/deletion behavior is stated near immediate and automatic mirror actions.
- [x] Job-level operational errors are displayed with their corresponding job.
- [x] Job removal uses an in-app confirmation and explicitly says that source and destination folders are not deleted.
- [x] Long paths can be expanded on both the list and job-detail views; each job shows its latest local run result or a clear not-run state.
- [x] Active and stopping mirror states are distinct, and the compact list keeps errors attached to their job.
- [~] Representative job-detail, preview, and failed-result states were visually checked with mock IPC; full manual validation of all job states and real path presentation remains outstanding.

### Phase 3 acceptance

- [x] The jobs page prioritizes job identity, status, and next action over configuration detail.
- [x] A user can distinguish Preview from an actual immediate mirror before activating either action.
- [x] `/MIR` overwrite and deletion behavior is stated clearly near the immediate and automatic mirror controls.
- [x] Removing a job never implies that its source or destination folders will be removed.

### Phase 3 implementation notes

- The list now presents each job’s name, automation state, latest local outcome and summary, and source/destination paths. Full paths are available by expanding the path disclosure.
- Each list item separates **Open details**, read-only **Preview**, and **Mirror now** actions; the `/MIR` overwrite/deletion warning is adjacent to these actions. Search and filtering were deliberately omitted because they add little value for the current expected list size.
- Removal requires an in-app confirmation that makes clear the folders remain untouched. Mirror errors, progress, stopping state, and latest outcome remain associated with the relevant job.
- Validation: `npm run typecheck` passed; `npm test` passed (63 passed, 1 skipped); the focused job-workspace/navigation tests passed (4 passed); and `npm run make` produced the Windows distributable successfully. Manual visual verification remains outstanding.

## Phase 4 — Guided job creation and job details

- [x] Move job creation out of the jobs list into a focused view, dialog, or step-by-step flow.
- [x] Gather job name, source folder, and destination folder in a clear order with labels, examples, and validation feedback.
- [x] Make folder browsing the obvious path-selection action while preserving direct path entry where supported.
- [x] Explain destination-folder requirements and development sandbox restrictions at the point they matter.
- [x] State clearly that newly created jobs start with automation disabled.
- [x] Provide a review step or summary before saving if it improves error prevention without adding unnecessary friction.
- [x] Preserve entered values when validation fails; define expected behavior for canceling or navigating away.
- [x] Create a dedicated Job details view reachable from each job.
- [x] Organize job details into clear sections for Overview, Folders and exclusions, Automation, and Runs.
- [x] Provide consistent back navigation to the jobs list and preserve useful list context.

### Phase 4 acceptance

- [x] Job creation explains required inputs and reports invalid values at the relevant field.
- [x] A failed save does not discard user-entered values.
- [x] A saved job is visibly disabled for automation until the user opts in.
- [x] Each job has a focused place for settings and history that does not expand every job card in the list.

### Phase 4 implementation notes

- Creation is a dedicated `#/jobs/new` flow with ordered inputs, field-level and cross-path validation, folder browsing and direct entry. Its review summary states that automation starts off and explains `/MIR` effects.
- Draft values live in the app state: validation/save errors and navigating back to the jobs list do not erase them; a successful save clears the draft and opens the new job.
- Each job detail route has Overview, Folders & exclusions, Automation, and Runs sections. Section links use URL fragments, the back link returns to Mirror jobs, and run history is scoped to the current job.

## Phase 5 — Exclusions and automation settings

- [x] Move exclusions out of expandable job cards and into the job details configuration area.
- [x] Separate built-in exclusions, technology presets, sensitive-file presets, and custom rules visually and semantically.
- [x] Explain that exclusions omit matching source items and remove matching destination items after a completed, non-cancelled run.
- [x] Make rule type, pattern, origin, and removal action easy to scan.
- [x] Improve validation and feedback for adding, removing, and saving rules.
- [x] Explain automation timing, worker behavior, and scheduled-task registration before or alongside enabling automation.
- [x] Present automation changes as explicit state transitions with progress and actionable failure feedback.
- [x] Ensure disabling automation communicates whether the owned scheduled task was removed successfully.

### Phase 5 acceptance

- [x] Users can understand which rules apply and how exclusions affect a mirror.
- [x] Enabling or disabling automation gives visible success or error feedback.
- [x] Scheduler errors do not leave the UI showing a state that was not successfully saved.

### Phase 5 implementation notes

- The job detail view separates inherited built-ins, technology presets, sensitive-file presets, and custom rules. Rules show type, pattern, origin, and a specific removal action. Custom rules use the backend validation rules before saving; failed saves retain the input and persisted rule list, while successful changes announce confirmation.
- Exclusion guidance explains that matching source items are omitted and matching destination items are removed after completed, non-cancelled runs. The current built-in and job exclusions are applied consistently to manual and worker-triggered runs.
- The read-only preview is intentionally unchanged and does not include this destination cleanup in its deletion counts.
- Automation settings explain the Task Scheduler worker, sign-in/source-change/daily triggers, possible immediate reconciliation, and `/MIR` effects. A successful disable reports whether the shared worker was removed or remains for other enabled jobs.
- Automation state is updated only after the IPC operation succeeds. If registration/removal fails, the checkbox stays at the last persisted state and the per-job error is shown; the main-process transaction rolls back failed scheduler changes.
- Validation: `npm run typecheck` passed; `npm test` passed (63 passed, 1 skipped); the focused navigation/exclusion tests passed (9 passed); and `npm run make` produced the Windows distributable successfully. Manual visual verification remains outstanding.

## Phase 6 — Preview and mirror outcomes

- [x] Present preview results in a focused page, dialog, or panel that is visually distinct from an actual run.
- [x] Keep the read-only nature and comparison limitations explicit.
- [x] Summarize new files, changed files, possible destination deletions, and warnings with clear hierarchy.
- [x] Make sample paths inspectable without overwhelming the main summary.
- [x] Keep deletion counts informational; do not make a threshold a blocker or imply it prevents deletion.
- [x] After a mirror, present outcome, duration, summary, and failure details in a consistent result surface.
- [x] Keep cancellation available while a run is active and reflect when cancellation is pending or unavailable.
- [x] Provide a clear route from a result to the corresponding Activity record.
- [x] Continue to distinguish local mirroring outcomes from cloud upload completion.

### Phase 6 acceptance

- [x] Preview cannot be mistaken for a completed or active mirror.
- [x] Preview never starts Robocopy or changes files.
- [x] A direct Mirror now action remains direct and does not gain a confirmation gate.
- [x] Run success, failure, and cancellation are distinguishable and explain the next useful step.

### Phase 6 implementation notes

- Preview remains a read-only panel and explicitly states that no mirror was run, which fields are compared, and that deletion thresholds are informational only.
- Manual run completion now has a shared result panel showing outcome, summary, duration, timestamp, exit code, and output truncation. It explains partial-change/cancellation limits and links to the Activity record. The app does not expose or claim to retain full Robocopy output.
- Validation: Activity/navigation-focused tests and `npm run typecheck` passed. Full suite and packaging validation are recorded in Phase 10 below.

## Phase 7 — Activity and diagnostics

- [x] Move full run history to a dedicated Activity page.
- [x] Present outcomes with consistent status labels, readable timestamps, trigger, duration, and useful summary.
- [x] Add filtering or sorting only where it materially helps locate runs; include a clear reset state.
- [x] Replace the cramped six-column table with a layout that works at the supported window size and scaling.
- [x] Provide a focused run-detail view for longer summaries or error details.
- [x] Keep refresh behavior explicit and show loading, empty, and error states.
- [x] Place diagnostics export in Activity or Settings with a concise privacy explanation.
- [x] Preserve the reminder that run history and exported diagnostics describe local mirroring only.

### Phase 7 acceptance

- [x] Users can find and understand recent runs without the history dominating the jobs workspace.
- [x] Long summaries and narrow layouts remain readable.
- [x] Diagnostics export remains user-initiated and its privacy implications are understandable.

### Phase 7 implementation notes

- Activity filters the newest 100 returned history records by job, outcome, and case-insensitive search, supports oldest/newest sorting, and provides a reset and no-match state. Run cards replace the wide table and link to individual details.
- Run details show available summary metadata only; they do not imply that raw Robocopy output is available. If a job was removed, its run remains viewable without a broken job link.
- Validation: helper and route tests pass; the full history and packaged UI still require end-to-end visual verification.

## Phase 8 — Settings and app information

- [x] Complete the Settings page scaffold with app-level information and support actions.
- [x] Show app version and relevant local profile/data information without exposing unnecessary implementation detail.
- [x] Provide diagnostics export or a clear route to it.
- [x] Explain local data storage and the distinction between development and installed profiles where appropriate.
- [x] Avoid controls for unsupported behavior or settings that cannot be changed by the user.
- [x] Ensure uninstall/data-retention explanations remain accurate: packaged-app uninstall removes its installed profile; development data is separate.

### Phase 8 acceptance

- [x] App-level information and support actions are separated from per-job settings.
- [x] Data and profile descriptions match actual behavior and do not suggest that development data is installed-app data.

### Phase 8 implementation notes

- Settings reports the app version and installed/development profile type without displaying the Windows username. It explains local profile retention and links to Activity for user-initiated diagnostics export.
- Runtime IPC now reports whether the app is packaged so the profile description matches the actual runtime.

## Phase 9 — Visual polish and accessibility

- [x] Apply the shared design tokens across navigation, pages, forms, cards, tables, dialogs, and feedback.
- [x] Establish a consistent typographic hierarchy and comfortable spacing for a desktop application.
- [x] Use restrained status colors with text labels so meaning is not conveyed by color alone.
- [x] Refine icons, buttons, hover states, disabled states, focus states, and destructive actions consistently.
- [x] Check contrast for normal text, secondary text, status colors, borders, and focus indicators.
- [ ] Check keyboard-only operation for navigation, job creation, menus, forms, rules, dialogs, and tables.
- [x] Check screen-reader semantics for page changes, busy states, validation errors, run completion, and automation state.
- [ ] Check long localized strings, long job names, deep Windows paths, empty data, large histories, and error messages.
- [ ] Check common Windows display scaling and window resizing down to the supported minimum.
- [ ] Keep visual treatments consistent with Windows conventions without relying on native dialogs for core flows.

### Phase 9 acceptance

- [~] Representative pages and states have a consistent visual hierarchy; not every state or packaged screen has been manually reviewed.
- [~] No document-level horizontal overflow was observed in the representative routes at 760 × 560 CSS pixels; other display scaling and content combinations remain to be checked.
- [~] Focus indication and labels were spot-checked, but full keyboard-only operation remains outstanding.
- [x] Status, warnings, and errors remain understandable without color.

### Phase 9 implementation notes

- Added a polite route-title announcement for page changes, explicit busy state for Activity refresh, and live run-result feedback. Existing controls retain visible focus styling and textual outcome labels.
- Runtime visual audit at 760 × 560 CSS pixels covered Overview, Jobs, job detail, job creation, Activity, run detail, and Settings using a mock IPC bridge. Screenshots showed no document-level horizontal overflow and the layouts remained readable at that viewport. This does not substitute for packaged-app validation or exhaustive content and scaling checks.
- Contrast calculations found the original focus indicator and control borders too faint. Updated the focus color to the primary blue (5.37:1 against the canvas) and the control border to slate (3.28:1 against the canvas); muted text remains above 4.5:1 on white.
- Follow-up rendering checked the read-only preview and failed-run result panel, Activity’s empty state and a 100-run history, plus keyboard Tab focus visibility. At 760 px wide, the Activity document remained within the viewport with all 100 run cards rendered.
- Keyboard-only, assistive-technology, Windows scaling, and full content/error-state acceptance remain unverified. Keep those items open until manually checked.

## Phase 10 — Validation and release readiness

- [x] Add/update focused tests for Activity filtering and run-detail navigation.
- [x] Verify existing backend behavior remains unchanged; the runtime-info IPC addition is limited to packaged/development identification.
- [x] Run type-check, targeted renderer tests, the full test suite, and production packaging.
- [ ] Perform manual end-to-end checks for first launch, adding a job, previewing, mirroring, enabling/disabling automation, reviewing Activity, and exporting diagnostics.
- [ ] Verify development and packaged copy differ only where behavior legitimately differs.
- [~] A representative two-job dashboard and a 100-run Activity list were rendered without document-level horizontal overflow; broader combinations and packaged builds remain unverified.
- [x] Confirm no test-created scheduler task, child process, or temporary data is left behind.
- [x] Update user documentation for navigation and revised workflows.

### Phase 10 acceptance

- [x] All automated checks pass and no unrelated backend or data behavior regresses.
- [ ] Core workflows pass manual checks in both development and packaged builds.
- [x] The finished app presents jobs, activity, and settings as distinct, navigable areas.
- [x] Any known UX limitations are recorded before release.

### Phase 10 validation notes

- `npm run typecheck` passed.
- Activity/navigation tests passed (6/6). The full suite passed serially (66 passed, 1 skipped). An initial parallel run encountered two transient `EBUSY` reads while Windows Robocopy had destination files open; both worker tests passed in isolation and in the serial suite. The `npm test` script now runs serially to avoid that Windows file-lock race.
- `npm run make` successfully produced the Windows Squirrel setup executable and package. After tests and packaging, no CodeMirror/Electron process, CodeMirror scheduled task, or CodeMirror test fixture remained.
- Manual visual, assistive-technology, scaling, and end-to-end checks are still required before treating release readiness as fully accepted. Activity retains summaries and exit metadata, not full Robocopy output.

## Suggested implementation order

1. Phase 0 — UX foundation and copy.
2. Phase 1 — App shell and navigation.
3. Phase 3 — Mirror jobs workspace.
4. Phase 4 — Guided job creation and job details.
5. Phase 5 — Exclusions and automation settings.
6. Phase 6 — Preview and mirror outcomes.
7. Phase 7 — Activity and diagnostics.
8. Phase 2 — Overview, once the destination pages and their summary data are established.
9. Phase 8 — Settings and app information.
10. Phase 9 — Visual polish and accessibility.
11. Phase 10 — Validation and release readiness.

Phases 2–8 can be implemented in parallel only after the app shell and navigation contracts are stable. Keep the listed sequence as the default to avoid polishing components before their final page structure is known.
