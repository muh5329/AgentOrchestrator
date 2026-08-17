# Agent Orchestrator

A desktop environment for building, running, judging and recursively orchestrating fleets of AI
agents. Projects contain agents; agents hold tools, permissions and memory; agents create tasks,
create other agents, invoke each other, and schedule their own work. An independent Judge decides
whether any of it is actually finished.

Everything is local: SQLite on disk, no proprietary backend, no telemetry.

![The workbench: projects, the live report, the fleet and its toolkit](screenshots/workbench.png)

Four panes, one window. Projects and their sections on the left; the live report, an agent's
document, the graph or the office floor in the centre; a command runner docked below; the fleet on
the right with the selected agent's toolkit under it. Everything in every pane is a real row - there
is no placeholder state anywhere in this application.

![The office floor: the fleet at work, with what they are saying](screenshots/floor.png)

The floor is the same data drawn as a place. Agents walk to the room their work belongs in - the
coding bay, the review lab, the planning room, the break room when they are idle - and their tool
calls, messages and verdicts surface as speech bubbles. It is a genuine view onto the event stream,
not an animation: when nothing is running, nothing moves.

## Running it

```bash
npm install          # dependencies only; no compilation
npm run dev          # provisions Electron + better-sqlite3 binaries, then launches
npm test             # 103 tests: unit, integration, workflow, git, release and restart-recovery
npm run build        # typecheck + bundle main, preload and renderer
npm run dist:mac     # package a .dmg
```

The default provider is the **Claude Code CLI**, which uses your existing subscription. Install it
and make sure `claude` is on your `PATH` (or set `AO_CLAUDE_BIN` to its absolute path). An
Anthropic API provider is also included — add a key in Settings → Providers to enable it.

### About the native modules

Two binaries have to be in place before the app runs: Electron itself, and `better-sqlite3`, which
is a compiled addon that only loads under the ABI it was built for. The app runs on Electron's Node;
the test suite runs on yours.

`npm install` alone is not enough to arrange that. npm 11 and later block dependency install scripts
by default, so Electron's postinstall never downloads its binary; and on npm 10 the same install
would try to *compile* `better-sqlite3` against your local Node, which fails on Node 24+ because V8
removed APIs it uses.

So the project provisions both itself. `scripts/ensure-native.mjs`, wired to `predev` and `pretest`,
downloads the Electron binary and fetches the right `better-sqlite3` prebuild for whichever runtime
is about to load it, stamping what it did so repeat runs are instant. Nothing is compiled, and your
system Node version does not matter for running the app.

    npm run rebuild:electron   # force the Electron-ABI binary
    npm run rebuild:node       # force the Node-ABI binary

The one hard constraint is the test suite, which does run on your Node. `better-sqlite3` publishes
prebuilds for Node 20 to 23 only, so on anything newer `npm test` stops with instructions:

```bash
brew install node@22
PATH="$(brew --prefix node@22)/bin:$PATH" npm test
```

The application itself is unaffected — it never uses your system Node.

## The shape of it

```
Electron main                          Renderer
├── db/          SQLite + Drizzle      ├── views/     report, floor, graph, agents,
├── services/    projects, agents,     │              tasks, workflows, workspace,
│                tasks, tools, memory, │              automation, memory, settings
│                messages, schedules,  ├── floor/     the office: layout, sprites,
│                approvals, budgets,   │              decor, simulation
│                workflows, git,       ├── store      live, event-driven
│                workspace, mail       └── api        one typed IPC channel
├── runtime/     agent runtime, tool
│                gateway, providers,
│                MCP bridge
└── engines/     execution manager, scheduler,
                 judge, watchdog, workflow engine
```

The renderer has no Node access and no database handle. It calls named methods over a single
validated IPC channel and receives every state change as a pushed event, so nothing polls.

## How the loop actually works

```
mission → Orchestrator plans → creates agents → delegates tasks
                                     ↓
                             agents execute in parallel
                             (spawn children, invoke peers,
                              call tools, message each other)
                                     ↓
                                 Judge evaluates
                                ↙             ↘
                          REJECTED          APPROVED
                             ↓                  ↓
                     revision task        task complete
                             ↓                  ↓
                          re-judge      board empties → project reviewed
                                                        against its own criteria
                                                       ↙                    ↘
                                              gaps → new work           signed off
```

A task is never complete because an agent said so. The Judge reads what the agent *did* — its tool
calls, the files that exist on disk, the test output — scores it against the task's acceptance
criteria on a weighted rubric, and either approves it, sends back a revision with specific required
changes, or escalates to you. When the board empties, the project itself goes to the Judge against
its own acceptance criteria; unmet criteria become a new round of work for the Orchestrator rather
than a silent "done".

## Agents

An agent is a persistent row, not a chat session: a system prompt, a model, a toolkit, a permission
set, a place in the graph, and a task history. Anything you can do to an agent in the UI, an agent
can do to another agent through a tool — that symmetry is the point. `create_agent`, `invoke_agent`,
`delegate_task`, `create_task`, `create_schedule` and `create_tool` are ordinary tools subject to the
ordinary permission gate.

Recursion is bounded by budget and permission, not by architecture. There is no hard-coded
"developer → QA → deploy" pipeline; hierarchies emerge from what the Orchestrator decides the
mission needs. Depth, fan-out, fleet size, turns, tool calls, runtime and spend are all configurable
per project and default to conservative values.

Two rules make delegation safe:

- **An agent can only grant permissions it holds itself.** Requested permissions are intersected
  with the creator's.
- **Anything irreversible asks a human.** Dangerous tools, and any permission listed in the
  project's approval policy, block the execution until you answer in the Approvals dock.

## Roles, blueprints and the shipping toolkit

Staffing a fleet from scratch means writing a system prompt for every agent. A **role** is a
starting posture instead: a name, standing instructions, a toolkit list and a permission request.
`list_roles` shows the Orchestrator what the fleet can hire and who already holds each role, and
`create_agent` takes a role name and uses it for anything you leave out — so an Orchestrator can
staff a Git Master without inventing what a Git Master is, and you can staff one from the same list
in the interface.

| Role | For |
| --- | --- |
| Orchestrator | Owns the mission: plans, staffs, delegates, follows up |
| Judge | Scores finished work against its acceptance criteria |
| Planner | Splits work into tickets a Judge could check |
| Ticket Master | Keeps the board honest — nothing stalls, nothing unassigned |
| Git Master | Branches, commits, merges, releases |
| Data Master | Schema, migrations, integrity |
| Watchdog | Watches dashboards and endpoints, raises what matters |
| Messenger | Posts to the board so everyone is told |
| Emailer | Drafts and sends outbound mail |
| Worker, Researcher | The general hands |

The catalogue is data, not code (`src/shared/agent-templates.ts`). Adding a role is adding an entry;
nothing anywhere branches on what a role "really" is, and a role's permissions are still intersected
with the creator's, so a template can ask for more than it will get.

An agent you have shaped by hand can be exported as a **blueprint** — a versioned JSON string with
its prompt, toolkits and permissions — and imported into another project. The same intersection
applies on import, so a blueprint can never smuggle in a permission the importing agent lacks.

The **Release** toolkit is what turns finished work into a shipped thing. Every tool does the real
operation, and the ones that depend on something your machine may not have say so plainly rather
than reporting a success nothing came from.

| Tool | What it does |
| --- | --- |
| `commit_and_push` | Stages, commits and pushes, setting upstream on first push |
| `release_branch` | Cuts `release/<version>` from HEAD |
| `create_pr` | Opens a pull request through the GitHub CLI |
| `worktree` | Lists agent worktrees, or merges one back |
| `bump_version` | Raises or sets the version in `package.json` |
| `release_notes` | Drafts notes from the log, grouped by conventional-commit prefix |
| `create_license` | Writes MIT, Apache-2.0, BSD-3-Clause or Unlicense |
| `dev_server` | Starts, stops or checks the command configured for the project |
| `open_in_editor` | Opens the workspace in your editor |
| `message_to_board` | Posts to the project board, broadcast or addressed |
| `send_email` | Sends over SMTP, once an account exists in Settings |

![The Release toolkit running create_license](screenshots/release-toolkit.png)

Email is hand-rolled against the protocol rather than pulled from a package — EHLO, STARTTLS,
AUTH LOGIN, MAIL FROM, RCPT TO, DATA — because that surface is small and a dependency is forever.
Nothing is sent until you configure an account, and "Test the connection" opens a real socket so a
wrong host or password fails where you are looking rather than inside an agent's run at 2am.

![Settings: the SMTP account and the project's local commands](screenshots/email-settings.png)

## Workflows

A workflow is a graph you can run on demand, on an event, or from an agent's `run_workflow` tool.
The builder is a real node editor: drag nodes from the palette, connect them, configure each one,
and watch nodes light up as a run moves through them.

| Node | What it does |
| --- | --- |
| Agent | Runs an agent on a task through the normal executor and waits for the result |
| Task | Creates a task, optionally without waiting |
| Tool | Calls a tool using a chosen agent's permissions |
| Condition | Branches on a sandboxed expression over the run context |
| Judge | Evaluates a task and puts the verdict in the context |
| Parallel / Merge | Runs branches concurrently and rejoins |
| Loop | Repeats a body while a condition holds, up to a maximum |
| Human approval | Blocks until you answer, with separate approved and denied branches |
| Delay, Webhook, End | Wait, call an HTTP endpoint, finish |

Nodes are not a second implementation of anything: an Agent node goes through the same executor as a
delegated task, so limits, budgets, judging and events behave identically. `{{variable}}`
substitution and `saveAs` carry results between nodes. Graphs are validated before they can be saved
or run - a condition with no `false` branch is caught at design time, not halfway through a run - and
a step budget stops a graph that loops instead of finishing.

## Working on code: worktrees, editor and console

Turn on workspace isolation and each agent gets **its own git worktree on its own branch**. Several
agents can then edit the same repository at once without the last writer winning, and the diff you
review at the end is per-agent instead of an indistinguishable mess. The Workspace view shows every
worktree with its agent, and lets you diff, merge or discard each branch.

It also carries a file tree, a Monaco editor for reading and light edits, a per-file diff view of
what agents changed, and a console for running commands in the workspace. The console is a command
runner, not a pseudo-terminal - there is no TTY, so interactive programs will not behave as they do
in your shell. That is a deliberate trade: a PTY means another native module, and what you actually
need here is to run a build and watch it scroll.

## Providers

`ProviderAdapter` is the seam. Three implementations ship:

| Adapter | What it is |
| --- | --- |
| `claude-code` | Spawns the local Claude Code CLI. Orchestration tools reach it as an MCP server over a loopback control plane, so tool calls still flow through the permission gate. Agent permissions map onto the CLI's own tools — an agent without `FILES_WRITE` genuinely cannot write. |
| `anthropic-api` | Direct Messages API with its own tool loop. The reference implementation of the runtime contract. |
| `scripted` | Deterministic, in-process, for the test suite and dry runs. Only registered when explicitly enabled, so it can never quietly stand in for a real model. |

## Durability

Schedules live in SQLite, not in timers. On startup the scheduler works out which firings it missed
while the app was closed and applies each schedule's catch-up policy (`run_once`, `run_all` or
`skip`). Tasks caught mid-flight by a crash are requeued with an explanatory error rather than left
hanging. Executions orphaned by a hard quit are reaped by the watchdog.

## The watchdog

Every running execution is checked for silence, runaway runtime, repeated tool failures and budget
exhaustion. The smallest useful action is taken first — nudge the parent agent, then escalate to a
human, then terminate — rather than letting a stuck agent burn tokens quietly.

## Tests

```
tests/domain.test.ts        projects, recursion limits, dependencies, memory, permissions
tests/judge.test.ts         verdict parsing, weighted scoring, thresholds, panel aggregation
tests/orchestration.test.ts the full loop end to end, project sign-off, safety refusals
tests/scheduler.test.ts     cron/interval/event/dependency triggers, catch-up, restart recovery
tests/watchdog.test.ts      stuck detection, escalation, budget enforcement
tests/workflow.test.ts     graph validation, branching, parallelism, loops, approvals, triggers
tests/git.test.ts          status and diff, worktree isolation, concurrent agents, merging
tests/release.test.ts      the shipping toolkit against a real repo, and hiring from the catalogue
```

Two of these are worth calling out. The workflow suite asserts that three 30ms parallel branches
finish in under 85ms, so "parallel" means concurrent rather than merely drawn side by side. The git
suite runs two agents that write the same file at the same time and then checks that each version
survives on its own branch and the shared checkout is untouched.

The end-to-end test drives the deterministic provider through the real runtime: the Orchestrator
staffs a fleet, a worker spawns a child of its own and invokes a peer, files land on disk, the Judge
rejects the first attempt, a revision runs, and the second attempt is approved — then asserts the
files, the graph edges, the nested execution records and the event timeline.

## Development scripts

```bash
npx vite-node scripts/seed-demo.ts -- .demo-userdata   # build a realistic database
xvfb-run -a node scripts/visual-check.mjs              # launch the app and screenshot every view
```

`scripts/visual-check.mjs` boots the real Electron app against a seeded database with Playwright and
captures each surface to `.shots/`, which is how the UI gets reviewed rather than assumed.

## The rest of it

| | |
| --- | --- |
| ![](screenshots/agent-document.png) | **An agent's document.** What it is for, the standing instructions it carries into every turn, its reach, its place in the fleet, and its work log - every run with its accounting, and for a failure, why it failed in its own words. |
| ![](screenshots/graph.png) | **The graph.** Who created whom, who delegates to whom, who invokes whom. Drawn from the same rows the runtime uses, so it cannot drift from what is actually happening. |
| ![](screenshots/verdict.png) | **A verdict.** The Judge's rubric, criterion by criterion, with the evidence that decided each one and the specific changes a rejection requires. |
| ![](screenshots/workflows.png) | **The workflow builder.** A real node editor; nodes light up as a run passes through them. |
| ![](screenshots/worktrees.png) | **Worktrees.** One branch and one checkout per agent, with the diff you review at the end kept per-agent instead of tangled together. |
| ![](screenshots/memory.png) | **Memory.** Constraints and decisions agents wrote for the agents that come after them. |
| ![](screenshots/usage.png) | **Usage.** Tokens and spend per agent, per task, per project, in real micro-dollars. |
| ![](screenshots/automation.png) | **Automation.** Schedules, triggers and the catch-up policy each one applies after a restart. |

## Keyboard

| | |
| --- | --- |
| `⌘K` | Command palette — navigate, run tasks, pause agents, switch projects |
| `⌘N` | New project |
| `⌘J` | Toggle the activity dock |

## What is not here

Kept honest rather than stubbed:

- The console has no PTY, as described above.
- `send_email` does nothing until you put an SMTP account in Settings → Email. It refuses and shows
  you the message it would have sent, rather than reporting a delivery that never happened.
- `create_pr` needs the GitHub CLI (`gh`) on your `PATH`. Without it the tool fails and tells you the
  branch and remote to open the request against by hand.
- Workflow schedules are wired through the existing scheduler rather than a separate cron field on
  the workflow itself; use a schedule whose task runs the workflow, or an event trigger.
- Only the macOS packaging target is configured. `electron-builder` needs a `win`/`linux` block and
  icons before it will produce anything for those.
