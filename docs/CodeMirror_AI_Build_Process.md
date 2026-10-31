# Building CodeMirror with AI: From an Idea to a Working Windows Application

## A first-person account of how I built a software product mostly by myself, using AI as my primary development collaborator

---

## 1. The starting point: a small, concrete problem

The project started with a practical problem rather than a fully formed product idea.

I work across different software projects and wanted a reliable way to mirror selected project folders into destinations managed by Google Drive for desktop. I did not want to copy everything. Development folders contain generated files, dependencies, build output, caches, and other content that should generally not be mirrored.

Initially, I approached the problem with scripts. That helped establish the basic workflow, but it also exposed the limitations of managing the process through separate scripts and launchers. I wanted one Windows desktop application where I could configure multiple independent mirror jobs and manage them from one place.

That became **CodeMirror**.

The important point is that I did not begin with a complete specification or a detailed architecture. I began with a problem I understood, then used AI to help turn that problem into a product.

## 2. Turning the idea into a product

Once the initial idea was clear, I used AI to interrogate and expand it.

Instead of immediately asking for code, I explored questions such as:

- Who or what is the product for?
- What is the primary user workflow?
- What should a mirror job contain?
- How should source and destination folders be selected and validated?
- How should exclusions work?
- What should happen when files change?
- Should mirroring be manual, automatic, or both?
- How should the application behave when it is closed?
- What happens when a job fails or a destination becomes unavailable?
- What should the user be able to inspect, preview, cancel, or configure?

This moved the idea from “I want to back up selected folders” to a more concrete product concept: a desktop application that manages multiple source-to-destination mirror jobs, supports exclusions, offers manual and automatic mirroring, and provides visibility into activity and failures.

**My role:** I supplied the problem, context, constraints, preferences, and decisions. AI helped me explore the problem space, identify missing questions, and structure the product concept.

## 3. Exploring the solution before committing to it

With the product direction clearer, I used AI to explore possible technical approaches and trade-offs.

The discussion covered the desktop application framework, frontend, backend/runtime responsibilities, local persistence, filesystem monitoring, synchronization, and Windows scheduling.

One important example was the choice of desktop stack. A Tauri-based approach was considered, but I questioned whether introducing Rust was necessary for this project. Given my existing familiarity with React and TypeScript, Electron with React and TypeScript was a more practical fit.

The resulting implementation uses:

- **Electron Forge** for the desktop application and packaging workflow.
- **Vite + React** for the renderer interface.
- **Strict TypeScript** for application contracts and type safety.
- **Electron preload and typed IPC** to separate the renderer from privileged operations.
- **SQLite** for local application data.
- **Robocopy** for Windows-native mirroring.
- **Windows Task Scheduler** and a headless worker for background operation.

This was not simply AI choosing a stack and me accepting it. I used AI to compare options, challenged recommendations that added unnecessary complexity, and made the final decisions.

## 4. Converting the product into requirements and workflows

Before implementation, I needed to make the product behavior explicit.

I worked through the main user journeys and the responsibilities of each part of the application. For example:

1. A user creates a mirror job.
2. The user chooses a source folder and a destination folder.
3. The application validates the paths and checks for conflicts.
4. The user configures exclusions.
5. The user can preview the proposed mirror operation.
6. The user can run a mirror immediately.
7. The user can enable automatic mirroring.
8. The application records run outcomes and makes them visible in Activity.

This step also forced important product decisions. For example, a new job is disabled by default; automatic mirroring must be explicitly enabled. Preview is read-only and separate from an actual mirror run. Removing a job does not delete either folder.

A particularly important behavior is Robocopy's `/MIR` mode: it can overwrite changed destination files and delete destination-only files. I made the product behavior explicit rather than allowing the interface to imply that mirroring was a harmless one-way copy. The final design explains this behavior near relevant actions. The product does not add a deletion-approval gate or a deletion-threshold block.

**The lesson:** requirements are not just a list of features. They include the rules, boundaries, failure behavior, and trade-offs that define what the product actually does.

## 5. Planning the implementation at two levels

I did not want to ask AI to build the entire application in one enormous step. I broke planning into two levels.

### 5.1 High-level implementation plan

First, I asked for the major systems and implementation phases.

The work was divided into areas such as:

- Application foundation and security boundaries
- Job configuration and local persistence
- Exclusion rules and preview
- File synchronization
- Background operation and scheduling
- Diagnostics and safety hardening
- Installer and release lifecycle
- User interface and experience

This gave me a map of the product and made dependencies easier to reason about.

### 5.2 Detailed implementation plan

Then I expanded those phases into smaller, verifiable tasks.

For example, “implement background mirroring” is too broad to build and test safely. It was decomposed into concrete responsibilities such as:

- Recursive source-folder watchers
- A quiet-period debounce and maximum wait
- Bounded retry behavior
- Daily full reconciliation
- A headless worker lifecycle
- Inter-process locks to prevent duplicate work
- Worker heartbeat and idle shutdown
- Task Scheduler registration, state checks, reconciliation, and cleanup

The plans tracked completion and verification, rather than merely listing features.

**Why this mattered:** I could give AI a bounded task, inspect the result, run the relevant checks, and only then move to the next task. The plan also gave me a way to notice missing work and avoid losing track of decisions across a long project.

## 6. Building incrementally with AI

Implementation was an iterative loop, not a single code-generation event.

My working cycle was:

1. Select one task from the implementation plan.
2. Give AI the relevant context, requirements, constraints, and existing code.
3. Ask it to implement a bounded change.
4. Review the proposed changes and how they fit the existing architecture.
5. Run type-checks and relevant tests.
6. Inspect failures and unexpected behavior.
7. Ask AI to diagnose and correct issues where appropriate.
8. Update the plan based on what was actually completed.
9. Move to the next task.

The application was built in layers. The foundation came first: the Electron application, the renderer/preload boundary, typed IPC, path validation, and development commands. Then came job configuration and persistence, exclusions and preview, synchronization, background operation, diagnostics, and packaging.

This approach made AI useful as an implementation partner without treating its output as automatically correct.

## 7. Refining the product, not just adding features

A product can be technically functional and still be confusing or unpleasant to use. I therefore treated refinement as a distinct part of the work.

The UI/UX plan covered a more deliberate desktop experience:

- A persistent navigation shell
- Overview dashboard
- Mirror jobs workspace
- Job creation and job details
- Exclusion management
- Automation controls
- Read-only preview
- Mirror result feedback
- Activity history
- Settings and diagnostics

The refinement work focused on making states and actions understandable. A user should be able to distinguish Preview from Mirror now, understand whether automation is enabled, see which job has an error, and understand what removing a job does.

I also refined operational behavior: clear status reporting, bounded child-process execution, cancellation, structured run history, log rotation, path redaction, and diagnostic export.

AI helped implement and review these refinements, but the product decisions remained mine. I chose which suggestions to adopt and which behavior should remain unchanged.

## 8. Automated testing and verification

I treated testing as part of implementation, not as something to do only at the end.

The project includes automated checks for important logic and operational behavior, including:

- Job and exclusion-rule validation
- Path conflicts and database behavior
- Windows-aware exclusion matching
- Robocopy argument construction and exit-code classification
- Preview behavior
- Missing-source failure
- `/MIR` overwrite and destination-only deletion behavior
- Worker startup and shutdown
- Duplicate-work prevention and heartbeat behavior
- Task Scheduler integration and cleanup
- Diagnostics privacy and retention
- Type-checking and packaging

Tests were designed to be bounded and safe. Task Scheduler integration testing is opt-in and uses a uniquely named disposable task with cleanup. Worker and child-process tests wait for shutdown and verify that test-owned processes are not left behind.

The key distinction is that a successful automated test proves the behavior covered by that test. It does not prove that the entire packaged product works correctly in every real Windows environment.

## 9. Human-in-the-loop testing

After automated verification, the next stage is testing the actual application as a person would use it.

I created a separate human testing guide rather than relying on an informal “open the app and see if it works” check.

The guide covers:

- First launch and basic navigation
- Creating a job and checking persistence after restart
- Previewing without changing files
- Running a mirror against disposable folders
- Confirming expected overwrite and destination-only deletion behavior
- Enabling and disabling automation
- Checking Task Scheduler cleanup
- Reviewing Activity and run details
- Exporting diagnostics and checking privacy
- Keyboard-only operation and accessibility
- Long paths, long job names, and Windows display scaling
- Worker recovery after logoff, reboot, or resume
- Installer lifecycle: clean install, upgrade, rollback, and uninstall
- Windows integration, performance, security, and process-leak checks

Safety is central to this stage. `/MIR` can overwrite destination files and delete destination-only files, so tests use disposable folders. Higher-risk installer and recovery checks are deferred to an isolated Windows account or virtual machine. A test is recorded as **Pass**, **Fail**, or **Not run** rather than being assumed complete.

This is where human judgment matters most: the tester validates whether the product behaves correctly and makes sense in a real environment, not merely whether the code passes its own tests.

## 10. Packaging and release readiness

The project has reached the point where a Windows Squirrel installer artifact can be generated. Profile-specific startup and Task Scheduler identity, as well as install/update/uninstall lifecycle handling, have been implemented.

However, generating an installer is not the same as completing release acceptance.

The recorded remaining work includes:

- Manual GUI create-and-restart verification
- Logoff, reboot, resume, and partial database/scheduler failure recovery checks
- Clean install, upgrade, rollback, and uninstall acceptance in a disposable Windows account or VM
- Windows integration, performance, security, and process-leak acceptance
- Final release checklist and documentation updates

I would present this honestly: the implementation and automated verification are substantially in place, while some real-world acceptance and release checks remain open.

## 11. How I used AI—and what I contributed

AI was involved throughout the lifecycle, but I was not simply asking it to “make an app” and accepting whatever it produced.

### AI helped me with

- Expanding an initial problem into a product concept
- Asking questions that exposed missing requirements
- Exploring frameworks and technical trade-offs
- Structuring architecture and implementation plans
- Breaking large features into smaller tasks
- Writing and modifying code
- Reviewing implementation approaches
- Diagnosing errors and test failures
- Creating automated tests
- Improving UX copy, states, and workflows
- Producing test plans and release checklists

### I contributed through

- Identifying the problem worth solving
- Providing the product context and constraints
- Choosing the desired behavior
- Challenging technical recommendations
- Making architecture and scope decisions
- Reviewing and directing implementation
- Running checks and evaluating results
- Deciding whether a change was acceptable
- Prioritizing refinements
- Owning the product's risks and release decisions

The distinction is important: AI accelerated the thinking, planning, coding, and testing work, but I remained responsible for the direction and decisions.

## 12. The overall process

The process can be summarized as:

**Problem → Idea → Product definition → Technical exploration → Requirements → High-level plan → Detailed plan → Incremental implementation → Refinement → Automated testing → Human testing → Release readiness**

It is not a strict one-way waterfall. Testing can reveal a requirement that needs clarification. Implementation can expose an architectural issue. Human testing can reveal a confusing workflow. Those findings feed back into the plan and the product.

The most useful capability I developed was not just generating code with AI. It was learning how to direct AI through a complete product-development process: giving it context, asking better questions, breaking work down, checking its output, and keeping decisions traceable.

## A concise way to describe the project

> I built CodeMirror largely on my own, using AI as my primary development collaborator. I started with a practical problem, used AI to help turn it into a defined product, explored and selected a suitable technical approach, created high-level and detailed implementation plans, and then built the application incrementally. I used AI throughout implementation, debugging, refinement, and automated testing, while reviewing the output and making the product decisions myself. I also created a structured human-testing process to validate real Windows workflows, safety, accessibility, recovery, and installer behavior. In short, I used AI not just to write code, but to help me move from an idea through product definition, engineering, verification, and release preparation.

---

## Project evidence and current status

The project artifacts that support this account are:

- `PLAN.md` — implementation phases, completed tasks, automated verification, packaging, and outstanding acceptance checks.
- `UI_UX_PLAN.md` — the detailed interface, navigation, workflows, interaction states, and UX refinements.
- `Human_In_Loop.md` — the manual testing procedure, safety requirements, acceptance checks, and release record.

The plans record Phases 0–5 as implemented and covered by automated verification, with the Windows installer artifact generated. They also explicitly retain open manual and release-acceptance items. The documents are evidence of the process and current recorded state; they should not be presented as proof that every remaining acceptance test has passed.
