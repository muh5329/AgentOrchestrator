# Agent Orchestrator — Project Learning Guide

> A short, practical guide for learning how the Agent Orchestrator codebase works.

Repository: `muh5329/AgentOrchestrator`

---

# 1. What Is This Project?

Agent Orchestrator is a desktop application for creating and coordinating AI agents.

The core idea is:

```text
Project
   ↓
Agents
   ↓
Tasks
   ↓
Tools
   ↓
Agent Execution
   ↓
Judge
   ↓
Approve / Reject
   ↓
More Work
```

An agent is not just a chat window.

An agent can have:

* Instructions
* Tools
* Permissions
* Memory
* Tasks
* Schedules
* Other agents
* Messages
* Workflows

The application can therefore create a fleet of agents that work together.

---

# 2. The Most Important Mental Model

Think of the application as five major layers:

```text
┌─────────────────────────────┐
│          Electron           │
│        Desktop Window       │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│          Renderer            │
│       React UI               │
└──────────────┬──────────────┘
               │ IPC
┌──────────────▼──────────────┐
│        Main Process          │
│     Application Logic        │
└──────────────┬──────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
    SQLite           Runtime
       │                │
       ▼                ▼
   Persistent       AI Agents
      State
```

Learn the project in this order.

---

# 3. Step 1 — Get the Application Running

Start here.

```bash
npm install
npm run dev
```

The project uses Electron Vite for development.

Other important commands:

```bash
npm test
npm run build
npm run typecheck
```

Mac packaging:

```bash
npm run dist:mac
```

---

# 4. Step 2 — Understand `package.json`

Open:

```text
package.json
```

This is the first file to understand.

It tells you:

* How the application starts
* How it builds
* How tests run
* Which libraries are installed
* How Electron is configured

Important technologies include:

```text
Electron
React
TypeScript
Vite
SQLite
Drizzle ORM
Zustand
Vitest
Tailwind
MCP
Zod
Monaco Editor
XYFlow
```

### Important scripts

```text
npm run dev
```

Starts the Electron development application.

```text
npm test
```

Runs the test suite.

```text
npm run build
```

Typechecks and builds the application.

```text
npm run typecheck
```

Checks TypeScript without producing a build.

---

# 5. Step 3 — Understand Electron

The application has three important Electron areas:

```text
src/main
src/preload
src/renderer
```

Think of them as:

```text
MAIN
"Can access the computer"

PRELOAD
"Safe bridge"

RENDERER
"Displays the UI"
```

This separation is extremely important.

---

# 6. Step 4 — Learn `src/main`

Open:

```text
src/main
```

This is the backend of the desktop application.

It contains:

```text
core/
db/
engines/
ipc/
runtime/
services/
util/
index.ts
```

The main process owns the application logic.

Start with:

```text
src/main/index.ts
```

Ask:

> How does the application start?

Then follow what it initializes.

---

# 7. Step 5 — Understand `core`

Open:

```text
src/main/core
```

Important files include:

```text
bootstrap.ts
context.ts
errors.ts
event-bus.ts
```

### `bootstrap.ts`

Responsible for starting the application's core infrastructure.

Think:

```text
Start application
↓
Create dependencies
↓
Initialize services
↓
Initialize engines
↓
Ready
```

### `context.ts`

Provides shared application context.

Think:

> "What does the rest of the application need access to?"

### `errors.ts`

Centralizes application errors.

### `event-bus.ts`

Allows parts of the application to communicate through events.

Think:

```text
Agent changed
    ↓
Event
    ↓
Interested systems react
```

---

# 8. Step 6 — Understand the Database

Open:

```text
src/main/db
```

You will find:

```text
client.ts
schema.ts
```

The project uses:

```text
SQLite
Drizzle ORM
better-sqlite3
```

### `schema.ts`

This defines the application's data model.

Start here.

Ask:

> What things does Agent Orchestrator permanently remember?

Look for entities representing concepts such as:

```text
Projects
Agents
Tasks
Tools
Messages
Memory
Schedules
Workflows
Approvals
Evaluations
Artifacts
```

### `client.ts`

This creates and manages the database connection.

Think:

```text
Application
   ↓
Database Client
   ↓
SQLite
```

---

# 9. Step 7 — Learn the Domain Model

Open:

```text
src/shared/domain.ts
src/shared/models.ts
```

These files are extremely important.

They describe the concepts used throughout the application.

Do not start by reading every function.

Instead ask:

```text
What is a Project?
What is an Agent?
What is a Task?
What is a Tool?
What is a Workflow?
What is a Message?
What is a Schedule?
What is an Evaluation?
```

Create your own mental model:

```text
Project
 ├── Agents
 ├── Tasks
 ├── Workflows
 ├── Schedules
 └── Settings

Agent
 ├── Prompt
 ├── Tools
 ├── Permissions
 ├── Memory
 └── Tasks
```

---

# 10. Step 8 — Understand Shared Types

Open:

```text
src/shared
```

Current important files include:

```text
agent-templates.ts
domain.ts
markdown.ts
models.ts
workflow.ts
```

These files are shared between application layers.

### `models.ts`

Understand the data structures.

### `domain.ts`

Understand the business concepts.

### `workflow.ts`

Understand how workflows are represented.

### `agent-templates.ts`

Understand how predefined agent configurations are created.

### `markdown.ts`

Understand how markdown/document content is processed.

---

# 11. Step 9 — Learn Services

Open:

```text
src/main/services
```

This is one of the most important folders.

The project currently contains services for:

```text
agent-service.ts
approval-service.ts
artifact-service.ts
blueprint-service.ts
budget-service.ts
evaluation-service.ts
fleet-service.ts
git-service.ts
mail-service.ts
manual-tool-service.ts
memory-service.ts
message-service.ts
orchestrator-service.ts
project-service.ts
schedule-service.ts
task-service.ts
tool-service.ts
workflow-service.ts
workspace-service.ts
```

Services generally answer:

> "How does the application perform this business operation?"

---

# 12. Step 10 — Learn `project-service`

Start with:

```text
project-service.ts
```

Learn how projects are:

```text
Created
Loaded
Updated
Deleted
Configured
```

The project is the top-level container.

Think:

```text
Project
   ↓
Everything else belongs to it
```

---

# 13. Step 11 — Learn `agent-service`

Open:

```text
agent-service.ts
```

This is where you should learn how agents are managed.

Ask:

```text
How is an agent created?
How is an agent updated?
How are its tools assigned?
How are permissions stored?
How is its status tracked?
```

The important idea:

> Agents are persistent application entities, not temporary chat windows.

---

# 14. Step 12 — Learn Tasks

Open:

```text
task-service.ts
```

A task represents work an agent needs to perform.

Think:

```text
Agent
 ↓
Task
 ↓
Execution
 ↓
Result
```

Learn:

```text
How tasks are created
How tasks are assigned
How tasks change status
How tasks are completed
How task results are recorded
```

---

# 15. Step 13 — Learn Tools

Open:

```text
tool-service.ts
```

Tools give agents capabilities.

Examples conceptually include:

```text
Read files
Write files
Run commands
Create tasks
Create agents
Message agents
Schedule work
Use external systems
```

The important concept is:

```text
LLM + Tools = Agent capable of doing things
```

---

# 16. Step 14 — Learn Permissions

Open:

```text
approval-service.ts
```

Agents should not automatically be allowed to perform everything.

Think:

```text
Agent requests action
        ↓
Permission check
        ↓
Allowed?
   ┌────┴────┐
   │         │
  Yes        No
   │         │
Execute    Approval
```

This is one of the most important safety mechanisms in the system.

---

# 17. Step 15 — Learn Memory

Open:

```text
memory-service.ts
```

Memory allows agents to retain useful information.

Think:

```text
Agent
 ↓
Memory
 ↓
Future execution
```

Study:

```text
How memory is stored
How memory is retrieved
How memory belongs to agents/projects
```

---

# 18. Step 16 — Learn Messaging

Open:

```text
message-service.ts
```

This handles communication between parts of the system.

Conceptually:

```text
Agent A
   ↓
Message
   ↓
Agent B
```

This becomes important when agents collaborate.

---

# 19. Step 17 — Learn the Orchestrator

Open:

```text
orchestrator-service.ts
```

This is one of the most important files in the entire project.

The Orchestrator is the manager.

Its job is conceptually:

```text
Mission
 ↓
Understand mission
 ↓
Create plan
 ↓
Create agents
 ↓
Create tasks
 ↓
Delegate
 ↓
Monitor
 ↓
React
```

The Orchestrator is not necessarily doing all the work itself.

It coordinates other agents.

---

# 20. Step 18 — Understand Fleet Management

Open:

```text
fleet-service.ts
```

The fleet represents a group of agents.

Think:

```text
              Orchestrator
              /     |     \
             /      |      \
         Agent A  Agent B  Agent C
            |        |        |
          Task     Task     Task
```

Learn how agents are grouped and coordinated.

---

# 21. Step 19 — Learn the Runtime

Open:

```text
src/main/runtime
```

This is where the application actually talks to AI providers and tools.

Important files:

```text
agent-runtime.ts
prompts.ts
provider-registry.ts
provider-types.ts
```

There are also:

```text
mcp/
providers/
tools/
```

---

# 22. Step 20 — Understand `agent-runtime.ts`

Start here:

```text
agent-runtime.ts
```

This is where the abstract idea of:

> "Run this agent"

becomes actual execution.

Think:

```text
Agent
 ↓
Prompt
 ↓
Model Provider
 ↓
LLM response
 ↓
Tool call?
 ↓
Execute tool
 ↓
Return result
 ↓
LLM continues
```

This loop is fundamental to understanding the project.

---

# 23. Step 21 — Understand Providers

Open:

```text
src/main/runtime/providers
```

Providers abstract the AI model.

Think:

```text
Agent
   ↓
Provider Interface
   ↓
Claude / Other Provider
```

The agent should not need to know every implementation detail of the underlying model.

---

# 24. Step 22 — Understand MCP

Open:

```text
src/main/runtime/mcp
```

MCP stands for:

```text
Model Context Protocol
```

It provides a standardized way for AI agents to interact with external tools/resources.

Mental model:

```text
Agent
 ↓
MCP
 ↓
External capability
```

Learn this after understanding ordinary tools.

---

# 25. Step 23 — Understand the Tool Runtime

Open:

```text
src/main/runtime/tools
```

This is where tool execution connects the agent to actual application capabilities.

Compare:

```text
tool-service
```

with:

```text
runtime/tools
```

A useful distinction is:

```text
Service
"What does the application know about this tool?"

Runtime
"How does this tool actually execute?"
```

---

# 26. Step 24 — Learn the Engines

Open:

```text
src/main/engines
```

Current engines include:

```text
execution-manager.ts
judge-engine.ts
scheduler.ts
watchdog-engine.ts
workflow-engine.ts
```

These are the application's automation mechanisms.

---

# 27. Step 25 — Learn `execution-manager.ts`

This manages execution.

Think:

```text
Task
 ↓
Execution Manager
 ↓
Agent Runtime
 ↓
Tools
 ↓
Result
```

This is a good bridge between:

```text
Tasks
```

and:

```text
Agents actually running
```

---

# 28. Step 26 — Learn the Judge

Open:

```text
judge-engine.ts
```

The Judge is extremely important.

The basic idea is:

```text
Agent says:
"I finished."

Judge says:
"Prove it."
```

The Judge evaluates whether work actually satisfies its requirements.

Conceptually:

```text
Task
 ↓
Acceptance Criteria
 ↓
Agent Work
 ↓
Evidence
 ↓
Judge
 ↓
PASS / FAIL
```

---

# 29. Step 27 — Understand the Judge Loop

The project is designed around a feedback loop.

```text
Task
 ↓
Agent executes
 ↓
Judge evaluates
 ↓
 ┌───────────────┐
 │               │
PASS            FAIL
 │               │
Done          Revision
                 │
                 ▼
               Agent
                 │
                 ▼
               Judge
```

This is one of the central concepts of Agent Orchestrator.

---

# 30. Step 28 — Learn Scheduling

Open:

```text
scheduler.ts
```

Scheduling allows work to happen automatically.

Think:

```text
Schedule
 ↓
Time arrives
 ↓
Task created/executed
 ↓
Agent works
```

Learn:

```text
How schedules are stored
How schedules are evaluated
How scheduled work is launched
```

---

# 31. Step 29 — Learn Watchdog

Open:

```text
watchdog-engine.ts
```

The Watchdog monitors the system.

Think:

```text
System running
      ↓
Watchdog observes
      ↓
Something wrong?
      ↓
Create/retrigger/recover
```

This helps make the system autonomous.

---

# 32. Step 30 — Learn Workflows

Open:

```text
workflow-engine.ts
```

Workflows describe multi-step execution.

Simple example:

```text
Research
   ↓
Implement
   ↓
Test
   ↓
Judge
```

A workflow turns multiple operations into an automated process.

---

# 33. Step 31 — Learn Git Integration

Open:

```text
git-service.ts
```

This handles Git-related operations.

Learn:

```text
Repositories
Branches
Commits
Status
Changes
```

This is particularly important because the agents are intended to work on real software projects.

---

# 34. Step 32 — Learn Workspaces

Open:

```text
workspace-service.ts
```

A workspace represents where an agent performs work.

Think:

```text
Agent
 ↓
Workspace
 ↓
Files
 ↓
Commands
 ↓
Changes
```

This is the bridge between AI reasoning and the user's actual project files.

---

# 35. Step 33 — Learn Artifacts

Open:

```text
artifact-service.ts
```

Artifacts represent produced outputs.

Examples might include:

```text
Documents
Reports
Generated files
Agent outputs
```

Learn how these outputs are persisted and associated with work.

---

# 36. Step 34 — Learn Evaluation

Open:

```text
evaluation-service.ts
```

Evaluation represents the system's assessment of work.

Think:

```text
Work
 ↓
Evidence
 ↓
Evaluation
 ↓
Decision
```

This works closely with the Judge.

---

# 37. Step 35 — Learn Blueprints

Open:

```text
blueprint-service.ts
```

Blueprints are reusable definitions for constructing agents or workflows.

Think:

```text
Blueprint
 ↓
Agent configuration
 ↓
New Agent
```

This avoids manually configuring every agent from scratch.

---

# 38. Step 36 — Learn Budgets

Open:

```text
budget-service.ts
```

Agent autonomy needs limits.

Budgets can control things such as:

```text
Execution
Tool calls
Turns
Resources
Spending
```

Think:

```text
Agent autonomy
+
Budget
=
Controlled autonomy
```

---

# 39. Step 37 — Learn the Preload Layer

Open:

```text
src/preload
```

Files:

```text
index.ts
index.d.ts
```

The preload layer creates the safe bridge between:

```text
Renderer
```

and:

```text
Electron Main
```

The renderer should not directly access Node APIs or the database.

Think:

```text
React UI
   ↓
Preload API
   ↓
IPC
   ↓
Main Process
```

---

# 40. Step 38 — Learn IPC

Open:

```text
src/main/ipc
```

IPC means:

```text
Inter-Process Communication
```

It is how the UI asks Electron's main process to perform operations.

Example:

```text
User clicks "Create Agent"
        ↓
React
        ↓
IPC
        ↓
Main process
        ↓
Agent Service
        ↓
SQLite
        ↓
Result
        ↓
React
```

Understanding this flow will make the entire UI much easier to understand.

---

# 41. Step 39 — Learn the Renderer

Open:

```text
src/renderer
```

This is the React frontend.

The renderer is responsible for:

```text
Displaying data
Receiving user input
Showing agents
Showing tasks
Showing workflows
Showing reports
Showing the visual floor
```

Do not start here.

Understand the backend first.

---

# 42. Step 40 — Learn the Visual Floor

The project includes a visual representation of agents working in an office-like environment.

Conceptually:

```text
Agent
 ↓
Current task
 ↓
Current state
 ↓
Location
 ↓
Visual representation
```

The floor is not just decoration.

It represents application state.

Think:

```text
Database state
      ↓
Agent state
      ↓
Floor visualization
```

---

# 43. Step 41 — Learn the Graph

The application also represents agent relationships as a graph.

Think:

```text
Orchestrator
    │
 ┌──┼─────┐
 ▼  ▼     ▼
A   B     C
│   │     │
D   E     F
```

The graph helps visualize:

```text
Who created whom
Who works with whom
Who is delegated to
How agents relate
```

---

# 44. Step 42 — Learn the UI State

The renderer uses client-side state management.

Look for the renderer's store/state code.

The purpose is:

```text
Backend event
 ↓
Frontend state
 ↓
React UI
```

The UI should represent the current application state rather than independently inventing it.

---

# 45. Step 43 — Learn Shared Markdown

Open:

```text
src/shared/markdown.ts
```

This handles markdown-related functionality.

This matters because agents can produce:

```text
Plans
Reports
Documents
Instructions
Task descriptions
```

---

# 46. Step 44 — Learn Workflows as Data

Open:

```text
src/shared/workflow.ts
```

Do not only learn the workflow engine.

First learn what a workflow **looks like as data**.

Then learn:

```text
Workflow data
 ↓
Workflow engine
 ↓
Execution
```

This distinction is important.

---

# 47. Step 45 — Learn Tests

Open:

```text
tests
```

Current test areas include:

```text
domain.test.ts
floor.test.ts
git.test.ts
judge.test.ts
markdown.test.ts
orchestration.test.ts
release.test.ts
scheduler.test.ts
watchdog.test.ts
workflow.test.ts
```

Tests are an excellent way to learn intended behavior.

---

# 48. Recommended Test Learning Order

Read tests in this order:

```text
domain.test.ts
      ↓
orchestration.test.ts
      ↓
judge.test.ts
      ↓
workflow.test.ts
      ↓
scheduler.test.ts
      ↓
watchdog.test.ts
      ↓
git.test.ts
      ↓
floor.test.ts
```

The tests often tell you what the author expects the system to do.

---

# 49. The Complete Execution Flow

Once you understand the pieces, connect them together.

A typical mission looks like this:

```text
USER
 │
 │ "Build feature X"
 ▼
PROJECT
 │
 ▼
ORCHESTRATOR
 │
 │ creates plan
 ▼
TASKS
 │
 ├──────────────┐
 ▼              ▼
AGENT A       AGENT B
 │              │
 │ tools        │ tools
 ▼              ▼
WORKSPACE     WORKSPACE
 │              │
 ▼              ▼
FILES         FILES
 │              │
 └──────┬───────┘
        ▼
     RESULTS
        │
        ▼
      JUDGE
        │
   ┌────┴─────┐
   ▼          ▼
 PASS        FAIL
   │          │
   │          ▼
   │       REVISION
   │          │
   │          ▼
   │        AGENT
   │          │
   │          └───────┐
   │                  │
   └──────────────────┘
            │
            ▼
         COMPLETE
```

---

# 50. The Most Important Data Flow

Learn this flow next:

```text
User
 ↓
UI
 ↓
IPC
 ↓
Service
 ↓
Database
 ↓
Engine
 ↓
Runtime
 ↓
Provider
 ↓
Agent
 ↓
Tool
 ↓
Workspace
 ↓
Result
 ↓
Judge
 ↓
Database
 ↓
Event
 ↓
UI
```

If you understand this, you understand the architecture.

---

# 51. The Agent Execution Loop

The agent itself can be understood as:

```text
Load Agent
   ↓
Load Prompt
   ↓
Load Memory
   ↓
Load Tools
   ↓
Load Permissions
   ↓
Send context to model
   ↓
Receive response
   ↓
Does model request a tool?
   │
   ├── NO → Finish/continue
   │
   └── YES
          ↓
       Permission check
          ↓
       Execute tool
          ↓
       Return result
          ↓
       Model continues
```

This is the core AI loop.

---

# 52. Agent-to-Agent Execution

The project also supports agents interacting with other agents.

Conceptually:

```text
Orchestrator
     │
     ├── delegates → Agent A
     │
     ├── delegates → Agent B
     │
     └── invokes → Agent C
```

Agents can therefore form dynamic hierarchies.

The important learning question is:

> What prevents uncontrolled recursion?

Study:

```text
Permissions
Budgets
Task ownership
Execution limits
Approval system
```

---

# 53. Learn the Project Through One Example

Do not try to understand everything at once.

Use one tiny mission:

```text
"Create a text file containing Hello World."
```

Trace it.

---

# 54. Example Learning Trace

Start with:

```text
Project
```

Then:

```text
Create Task
```

Then:

```text
Assign Agent
```

Then:

```text
Agent Runtime
```

Then:

```text
Tool
```

Then:

```text
Workspace
```

Then:

```text
File created
```

Then:

```text
Judge
```

Then:

```text
Task completed
```

Follow the code for this single scenario.

---

# 55. Second Learning Exercise

Use:

```text
"Create a task for another agent."
```

Now trace:

```text
Agent
 ↓
Tool
 ↓
Task Service
 ↓
Database
 ↓
New Task
 ↓
New Agent
 ↓
Execution
```

This teaches the recursive nature of the system.

---

# 56. Third Learning Exercise

Use:

```text
"Create a task that runs every day."
```

Trace:

```text
Agent
 ↓
Schedule Tool
 ↓
Schedule Service
 ↓
Database
 ↓
Scheduler
 ↓
Task
 ↓
Agent
```

This teaches autonomous scheduling.

---

# 57. Fourth Learning Exercise

Use:

```text
"Build a feature and verify that it works."
```

Trace:

```text
Mission
 ↓
Orchestrator
 ↓
Task
 ↓
Agent
 ↓
Tools
 ↓
Implementation
 ↓
Judge
 ↓
Pass / Fail
```

This teaches the full orchestration loop.

---

# 58. Fifth Learning Exercise

Force a failure.

For example:

```text
"Create a function that passes these acceptance criteria."
```

Give it an intentionally impossible requirement.

Then watch:

```text
Agent
 ↓
Judge
 ↓
Rejected
 ↓
Revision
 ↓
Agent
 ↓
Judge
```

This is one of the best ways to understand the Judge architecture.

---

# 59. Recommended Learning Order

Do NOT read the repository alphabetically.

Use this order:

```text
1. package.json

2. src/main/index.ts

3. src/main/core

4. src/shared/models.ts

5. src/shared/domain.ts

6. src/main/db/schema.ts

7. project-service.ts

8. agent-service.ts

9. task-service.ts

10. tool-service.ts

11. orchestrator-service.ts

12. agent-runtime.ts

13. provider-registry.ts

14. runtime/tools

15. approval-service.ts

16. execution-manager.ts

17. judge-engine.ts

18. workflow-engine.ts

19. scheduler.ts

20. watchdog-engine.ts

21. workspace-service.ts

22. git-service.ts

23. IPC

24. preload

25. renderer

26. floor

27. tests
```

---

# 60. What NOT To Learn First

Avoid starting with:

```text
Complex UI components
CSS
Animations
Floor graphics
Monaco editor
Graph rendering
Packaging
Electron configuration
```

These are easier after the backend mental model is understood.

---

# 61. The Five Classes of Code

When opening a file, classify it immediately.

### Data

```text
schema.ts
models.ts
domain.ts
```

Question:

> What does the application remember?

### Services

```text
*-service.ts
```

Question:

> What business operation is happening?

### Engines

```text
*-engine.ts
scheduler.ts
execution-manager.ts
```

Question:

> What automated process is running?

### Runtime

```text
agent-runtime.ts
providers/
tools/
mcp/
```

Question:

> How does the AI actually execute?

### UI

```text
renderer/
preload/
```

Question:

> How does the user interact with the system?

---

# 62. A Simple Vocabulary

## Project

The top-level container.

## Agent

An autonomous worker.

## Task

A unit of work.

## Tool

A capability an agent can invoke.

## Memory

Information retained for future agent execution.

## Workflow

A sequence or structure of automated operations.

## Schedule

A rule for running work at a future time.

## Orchestrator

The agent responsible for coordinating other agents.

## Judge

The agent/system responsible for deciding whether work actually meets its requirements.

## Workspace

The environment where work is performed.

## Artifact

A produced piece of output.

## Approval

A human authorization boundary.

## Engine

A long-running piece of application automation.

## Runtime

The mechanism that actually runs agents.

## Provider

The implementation that communicates with an AI model.

---

# 63. The Architecture in One Diagram

```text
                     USER
                       │
                       ▼
                ┌─────────────┐
                │   REACT UI  │
                └──────┬──────┘
                       │
                      IPC
                       │
                ┌──────▼──────┐
                │   SERVICES  │
                └──────┬──────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       SQLite        ENGINES      RUNTIME
          │            │            │
          │            │       ┌────┴─────┐
          │            │       ▼          ▼
          │            │    PROVIDER    TOOLS
          │            │       │          │
          │            │       ▼          ▼
          │            │      LLM      WORKSPACE
          │            │       │          │
          └────────────┴───────┴──────────┘
                       │
                       ▼
                     JUDGE
                       │
                ┌──────┴──────┐
                ▼             ▼
             APPROVE        REVISE
                │             │
                └──────┬──────┘
                       ▼
                    COMPLETE
```

---

# 64. The Application's Core Philosophy

The application is essentially trying to solve:

```text
How do I let many AI agents work autonomously
without losing control of what they are doing?
```

It answers that with:

```text
Agents
+
Tasks
+
Tools
+
Permissions
+
Memory
+
Workflows
+
Scheduling
+
Budgets
+
Judging
+
Human Approval
```

---

# 65. If You Only Learn 10 Files

If you want the shortest possible path, learn these first:

```text
package.json

src/main/index.ts

src/main/db/schema.ts

src/shared/domain.ts

src/shared/models.ts

src/main/services/agent-service.ts

src/main/services/task-service.ts

src/main/services/orchestrator-service.ts

src/main/runtime/agent-runtime.ts

src/main/engines/judge-engine.ts
```

These should give you the basic architecture.

---

# 66. If You Want to Understand Agent Creation

Follow:

```text
UI
 ↓
IPC
 ↓
agent-service
 ↓
database
 ↓
agent-runtime
```

Then investigate:

```text
Tools
Permissions
Memory
Prompt
Provider
```

---

# 67. If You Want to Understand Task Execution

Follow:

```text
task-service
 ↓
execution-manager
 ↓
agent-runtime
 ↓
provider
 ↓
tool
 ↓
workspace
```

---

# 68. If You Want to Understand Autonomous Agents

Follow:

```text
orchestrator-service
 ↓
task-service
 ↓
agent-service
 ↓
execution-manager
 ↓
scheduler
 ↓
watchdog
 ↓
judge
```

---

# 69. If You Want to Understand the AI

Follow:

```text
agent-runtime.ts
 ↓
prompts.ts
 ↓
provider-types.ts
 ↓
provider-registry.ts
 ↓
providers/
 ↓
tools/
 ↓
mcp/
```

Ignore the UI initially.

---

# 70. If You Want to Understand the UI

Follow:

```text
renderer
 ↓
preload
 ↓
IPC
 ↓
services
 ↓
database
```

Always work backward from a UI action.

Example:

```text
Click "Create Agent"
 ↓
Find React handler
 ↓
Find IPC method
 ↓
Find main-process handler
 ↓
Find service
 ↓
Find database operation
```

---

# 71. The Best Way to Read Any File

For every file, ask only five questions:

```text
1. What does this file own?

2. What does it receive?

3. What does it produce?

4. What does it call?

5. Who calls it?
```

Do not initially read every line.

---

# 72. The Best Way to Trace a Feature

Pick a feature.

For example:

```text
Create Agent
```

Search for:

```text
createAgent
```

Then trace:

```text
UI
 ↓
IPC
 ↓
Service
 ↓
Database
 ↓
Event
 ↓
UI update
```

Repeat this for:

```text
Create Task
Run Agent
Create Tool
Send Message
Schedule Task
Judge Task
Create Workflow
```

---

# 73. Suggested One-Day Learning Plan

## Hour 1

Learn:

```text
Electron
package.json
src/main
src/preload
src/renderer
```

## Hour 2

Learn:

```text
SQLite
Drizzle
schema
models
domain
```

## Hour 3

Learn:

```text
Projects
Agents
Tasks
Tools
```

## Hour 4

Learn:

```text
Agent Runtime
Providers
MCP
```

## Hour 5

Learn:

```text
Orchestrator
Execution Manager
Judge
```

## Hour 6

Learn:

```text
Scheduler
Workflow
Watchdog
Memory
Permissions
```

## Hour 7

Trace one complete mission.

## Hour 8

Read the tests.

---

# 74. Suggested Multi-Day Learning Plan

## Day 1 — Application

Learn:

```text
Electron
React
Vite
Main
Preload
Renderer
```

## Day 2 — Data

Learn:

```text
SQLite
Drizzle
Schema
Models
Domain
```

## Day 3 — Agents

Learn:

```text
Agent
Task
Tool
Memory
Permissions
```

## Day 4 — AI Runtime

Learn:

```text
Runtime
Providers
Prompts
MCP
Tool execution
```

## Day 5 — Orchestration

Learn:

```text
Orchestrator
Execution Manager
Fleet
Workflows
Scheduler
```

## Day 6 — Verification

Learn:

```text
Judge
Evaluation
Watchdog
Budgets
Approvals
```

## Day 7 — UI

Learn:

```text
IPC
React state
Reports
Agents view
Graph
Floor
```

---

# 75. Final Mental Model

When you are finished learning the repository, you should be able to explain it like this:

```text
Agent Orchestrator is an Electron application.

The React renderer provides the interface.

The preload layer safely exposes application operations.

The main process owns the actual application logic.

Services implement business operations.

SQLite stores persistent state.

The runtime executes AI agents.

Tools give agents capabilities.

Workspaces give agents places to perform work.

The Orchestrator coordinates agents.

The Scheduler triggers future work.

The Workflow Engine coordinates multi-step processes.

The Watchdog observes ongoing activity.

The Judge determines whether work is actually complete.

The UI visualizes all of this state.
```

The entire system can therefore be reduced to:

```text
STORE
  ↓
UNDERSTAND
  ↓
PLAN
  ↓
DELEGATE
  ↓
EXECUTE
  ↓
OBSERVE
  ↓
JUDGE
  ↓
REVISE
  ↓
COMPLETE
```

That is the architecture you should keep in your head while reading the code.
