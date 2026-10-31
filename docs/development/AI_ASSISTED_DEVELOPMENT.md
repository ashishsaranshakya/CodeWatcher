# Building CodeMirror with AI

## How I took a practical idea to a Windows desktop application, largely by myself

This document describes my development process: how I used AI as my primary
development collaborator to explore a problem, define a product, make technical
decisions, plan the work, implement the application, refine it, and verify it.

The goal is not to suggest that AI independently created the product. I
provided the problem, context, constraints, priorities, and decisions. AI
helped me reason through the work and execute many of the engineering tasks. I
reviewed the output, challenged recommendations, evaluated test results, and
remained responsible for the product.

## 1. Starting with a problem

The project began with a practical workflow problem.

I wanted to mirror selected software project folders to local destinations
managed by Google Drive for desktop, while excluding dependencies, generated
files, build output, caches, and other content that should not be copied.

I initially explored scripts to perform the mirroring. That helped establish
the workflow, but managing multiple source/destination pairs, exclusions,
automation, and operational status through separate scripts was not the
experience I wanted.

I began considering a Windows desktop application that could manage multiple
independent mirror jobs from one place. That became CodeMirror.

I did not begin with a complete product specification or architecture. I
started with a problem I understood and used AI to help expand it into a
product concept.

## 2. Expanding the idea into a product

Rather than immediately asking AI to write the application, I used it to help
identify the questions that needed answers.

For example:

- What does a mirror job contain?
- How should source and destination folders be selected and validated?
- How should exclusions be configured?
- Should the application support manual runs, automatic runs, or both?
- What happens when the application is closed?
- How should background work start and stop?
- How should failures, retries, and unavailable folders be handled?
- What should Preview show, and should it be allowed to change files?
- How should users inspect activity and diagnose problems?
- What should happen when a job is removed or automation is disabled?

This moved the concept from “copy selected folders” to a more specific
application: a Windows desktop tool for managing multiple filtered local
folder mirrors, with manual and opt-in automatic operation, preview, activity,
and diagnostics.

The product behavior and boundaries are documented in
[Product overview](../PRODUCT_OVERVIEW.md).

**My contribution:** I supplied the original problem, explained the workflow,
set constraints, answered questions, and made the product decisions. AI helped
me explore the problem space and expose requirements I had not yet considered.

## 3. Exploring technical options and making decisions

Once the product direction was clearer, I used AI to compare technical
approaches and understand their trade-offs.

The exploration covered the desktop framework, frontend, runtime
responsibilities, local persistence, filesystem monitoring, synchronization,
and Windows scheduling.

One example was the desktop framework. Tauri was considered, but I questioned
whether introducing Rust was necessary for this project. Given my existing
familiarity with React and TypeScript, Electron with React and TypeScript was a
more practical fit.

The implementation uses:

- Electron Forge for the desktop application and packaging workflow.
- Vite and React for the renderer interface.
- Strict TypeScript for application contracts and type safety.
- An Electron preload boundary and typed IPC for communication between the
  renderer and privileged application code.
- SQLite for local application data.
- Robocopy for Windows-native mirroring.
- Windows Task Scheduler and a headless worker for background operation.

AI helped evaluate options, but I did not treat its recommendations as
decisions. I questioned unnecessary complexity and selected the approach that
fit the product and my existing skills.

## 4. Making product behavior explicit

Before implementation, I worked through the application's main workflows and
the rules that should govern them.

A typical workflow became:

1. Create a mirror job.
2. Select a source and destination folder.
3. Validate the paths and check for conflicts.
4. Configure exclusions.
5. Preview potential changes.
6. Run a mirror immediately, or explicitly enable automation.
7. Inspect run outcomes and history.

This stage was important because requirements are more than feature names.
They include default states, boundaries, error handling, and behavior that
users need to understand.

Examples of decisions made explicit in the product:

- New jobs start with automation disabled.
- Preview is read-only and does not start Robocopy.
- Removing a job does not delete its source or destination folders.
- Manual and automatic runs use Robocopy `/MIR`.
- `/MIR` can overwrite matching destination files and delete destination-only
  files.
- The product does not require deletion approval or enforce a deletion
  threshold.
- Development builds restrict folder selection to a dedicated sandbox, while
  installed builds allow validated folders outside it.

The `/MIR` behavior also includes post-run cleanup of destination items covered
by the current built-in and job exclusions after a run that is neither failed
nor cancelled. The preview's deletion counts do not include that cleanup.
These details matter because the preview and the final mirror operation are
not identical in every reported deletion category.

I used AI to help surface and articulate these decisions, but I chose the
behavior the product would implement.

## 5. Planning at two levels

I did not want to ask AI to build the entire application in one large step. I
used a two-level planning process.

### 5.1 High-level implementation plan

First, I identified the major systems and work areas:

- Application foundation and security boundaries
- Job configuration and local persistence
- Exclusions and preview
- Synchronization
- Background operation and scheduling
- Diagnostics and safety hardening
- Installer and release lifecycle
- User interface and experience

This gave me a map of the product and helped establish dependencies.

### 5.2 Detailed implementation plan

Next, I broke each area into smaller tasks that could be implemented and
verified independently.

For example, background mirroring was decomposed into:

- Recursive source-folder watchers
- Quiet-period debounce and maximum wait
- Bounded retry behavior
- Daily full reconciliation
- Headless worker lifecycle
- Cross-process locks to prevent duplicate job runs
- Worker heartbeat and idle shutdown
- Task Scheduler registration, state checks, reconciliation, and cleanup

The implementation plan tracked tasks and verification status rather than
serving only as a feature wishlist.

See [PLAN.md](PLAN.md) for the engineering phases, recorded implementation
status, and outstanding acceptance work.

## 6. Designing the user experience

I treated the interface as a product in its own right rather than as a thin
wrapper around backend functionality.

The UI/UX work established a persistent desktop navigation structure:

- Overview
- Mirror jobs
- Activity
- Settings

It also covered the job-creation flow, job details, exclusions, automation
controls, preview, mirror results, activity history, and diagnostics.

The refinement focused on making the application's states and actions
understandable. A user should be able to distinguish Preview from Mirror now,
see whether automation is enabled, identify which job has an error, and
understand what removing a job does.

The detailed UI/UX implementation record is
[UI_UX_PLAN.md](UI_UX_PLAN.md).

## 7. Implementing incrementally with AI

Implementation was an iterative cycle rather than a single code-generation
request.

For each bounded task, my working loop was:

1. Select a task from the implementation plan.
2. Give AI the relevant project context, requirements, constraints, and code.
3. Ask it to implement a focused change.
4. Review the proposed implementation and how it fits the existing design.
5. Run type-checking and relevant tests.
6. Inspect failures and unexpected behavior.
7. Use AI to help diagnose and correct issues where appropriate.
8. Update the implementation plan to reflect what was actually completed.
9. Move to the next task.

The application was built in layers. The foundation came first: Electron,
Vite, React, TypeScript, the preload boundary, typed IPC, path validation, and
development commands. Job configuration and persistence followed, then
exclusions and preview, synchronization, background operation, diagnostics,
and packaging.

AI generated and modified code, helped debug issues, and contributed to test
creation. I reviewed the changes and used test results and observed behavior
to decide whether work was complete.

## 8. Refining behavior and operational quality

A feature can work technically and still be confusing or unreliable in
practice. Refinement therefore included both user experience and operational
behavior.

Examples included:

- Clear loading, empty, busy, success, cancellation, and error states.
- Job-specific status and error feedback.
- Clear separation between preview and actual mirroring.
- Understandable run summaries and Activity details.
- Bounded Robocopy child-process execution and cancellation.
- Worker startup, shutdown, heartbeat, and duplicate-run prevention.
- Structured logs, log rotation, retention, and path redaction.
- User-initiated diagnostic export with privacy-conscious contents.
- Profile-specific worker identity and Task Scheduler ownership.

I used AI to help implement and review these refinements. I decided which
changes were appropriate and whether they matched the product's intended
behavior.

## 9. Automated testing and verification

Testing was part of the implementation cycle, not a final activity added after
all coding was finished.

The implementation records cover automated checks for areas including:

- Job and exclusion-rule contracts
- Path validation and conflicts
- Database behavior and persistence
- Windows-aware exclusion matching
- Robocopy argument construction and exit-code classification
- Read-only preview behavior
- Missing-source failure
- `/MIR` overwrite and destination-only deletion behavior
- Worker lifecycle and shutdown
- Cross-process duplicate prevention and heartbeat behavior
- Task Scheduler integration and cleanup
- Diagnostics privacy and retention
- Type-checking and packaging

The tests were designed to be bounded and safe. The normal test suite does not
create a scheduled task. The optional Scheduler integration test uses a
uniquely named disposable task and verifies cleanup in `finally`. Worker and
child-process tests wait for shutdown and check that test-owned processes are
not left behind.

A passing automated test proves the behavior covered by that test. It does
not establish that the entire packaged product has been accepted in every
real Windows environment.

## 10. Human-in-the-loop testing

I created a separate manual verification guide so that testing the application
would be a repeatable process rather than an informal final check.

The guide covers:

- First launch, navigation, and job creation
- Persistence after closing and reopening the application
- Preview without changing files
- Manual mirroring against disposable folders
- Expected overwrite and destination-only deletion behavior
- Enabling and disabling automation
- Task Scheduler registration and cleanup
- Activity and diagnostic export
- Keyboard-only operation and accessibility
- Long paths, long job names, and Windows display scaling
- Worker recovery after logoff, reboot, or resume
- Clean install, upgrade, rollback, and uninstall
- Windows integration, performance, security, and process-leak checks

Safety is important because `/MIR` can overwrite destination files and delete
destination-only files. Ordinary workflows should use disposable folders.
Higher-risk installer, recovery, and failure-injection checks should be
performed in an isolated Windows account or virtual machine. Each check is
recorded as **Pass**, **Fail**, or **Not run**, with the build and environment
identified.

See [Human_In_Loop.md](../testing/Human_In_Loop.md) for the manual procedure
and acceptance record.

## 11. Packaging and release readiness

The implementation plan records that a Windows Squirrel installer artifact
has been generated. Profile-specific startup and Task Scheduler identity, as
well as install/update/uninstall lifecycle handling, have also been
implemented.

Generating an installer is not the same as completing release acceptance.

The recorded remaining work includes:

- Manual GUI job creation and restart-persistence verification
- Logoff, reboot, resume, and partial database/scheduler failure recovery
- Clean install, upgrade, rollback, and uninstall acceptance in a disposable
  Windows account or VM
- Windows integration, performance, security, and process-leak acceptance
- Final release checklist and documentation updates

The UI/UX plan also retains manual end-to-end, accessibility, assistive
technology, and Windows scaling checks. The current status should therefore be
described as substantial implementation and automated verification completed,
with some manual and release acceptance still outstanding.

The authoritative task status is in [PLAN.md](PLAN.md) and
[UI_UX_PLAN.md](UI_UX_PLAN.md), rather than in this retrospective narrative.

## 12. How AI and I contributed

### AI helped with

- Expanding the initial problem into a product concept
- Generating questions to expose missing requirements
- Exploring technical options and trade-offs
- Structuring implementation plans
- Breaking large features into smaller tasks
- Writing and modifying code
- Reviewing approaches and diagnosing failures
- Creating and improving automated tests
- Refining UX copy, states, and workflows
- Producing testing and release documentation

### I contributed through

- Identifying the problem worth solving
- Providing context, constraints, and priorities
- Defining desired product behavior
- Challenging technical recommendations
- Making architecture and scope decisions
- Reviewing and directing implementation
- Running checks and evaluating results
- Deciding whether changes were acceptable
- Prioritizing refinements
- Owning the product's risks and release decisions

The distinction is important. AI accelerated the thinking, planning, coding,
debugging, and testing work, but I remained responsible for the direction and
decisions.

## 13. The process in one view

The overall process can be summarized as:

**Problem → Idea → Product definition → Technical exploration → Requirements
→ High-level plan → Detailed plan → Incremental implementation → Refinement
→ Automated testing → Human testing → Release preparation**

This was not a strict one-way waterfall. Testing could expose a requirement
that needed clarification. Implementation could reveal an architectural
problem. Human testing could reveal a confusing workflow. Those findings fed
back into the plan and the product.

The capability I developed was not just generating code with AI. It was
learning how to direct AI through a complete product-development process:
providing context, asking better questions, decomposing work, evaluating
outputs, and keeping decisions traceable.

## A concise description

> I built CodeMirror largely on my own, using AI as my primary development
> collaborator. I started with a practical problem, used AI to help turn it
> into a defined product, explored and selected a suitable technical approach,
> created high-level and detailed implementation plans, and then built the
> application incrementally. I used AI throughout implementation, debugging,
> refinement, and automated testing, while reviewing the output and making the
> product decisions myself. I also created a structured human-testing process
> to validate real Windows workflows, safety, accessibility, recovery, and
> installer behavior. I used AI not just to write code, but to help me move
> from an idea through product definition, engineering, verification, and
> release preparation.

## Supporting project artifacts

These documents provide the implementation evidence behind this account:

- [Product overview](../PRODUCT_OVERVIEW.md) — what CodeMirror is designed to
  do and the behavior it implements.
- [Implementation plan](PLAN.md) — implementation phases, completed work,
  automated verification, and remaining acceptance checks.
- [UI/UX implementation plan](UI_UX_PLAN.md) — interface structure, user
  workflows, design decisions, and validation.
- [Human-in-the-loop verification](../testing/Human_In_Loop.md) — manual
  testing procedures, safety requirements, and release acceptance.
- [Repository README](../../README.md) — setup, development commands,
  operational behavior, and documentation index.

The implementation and testing plans are evidence of the recorded work and
status. They should not be presented as proof that every outstanding manual
acceptance check has passed.
