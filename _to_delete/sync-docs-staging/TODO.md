# Future work

An honest list of what is missing, what is shallow, and what would break if you pushed on it.
Ordered by what I would do next, not by how interesting it is.

Each item has an acceptance criterion, because this is an application built on the premise that
"done" is a claim someone else should be able to check.

---

## P0 — Before trusting it with real work

### 1. Run the Claude Code CLI provider for real — DONE, but only once

`scripts/live-claude-check.ts` drives a real `claude` binary end to end: an agent completes a task,
the tool calls go through `ToolRuntime`, and an agent without `FILES_WRITE` is refused when it
reaches for Write and then Edit. That closes the original doubt about the wire format.

What is still thin: it has been run against one CLI version, on one machine, on a happy path plus
one denial. The stream-json field names and the `--mcp-config` handling are verified for that
version and no other, and nothing re-runs it in CI.

**Done when:** the live check runs on every release, against the CLI version pinned in the README.

### 1b. Everything else still runs on the scripted provider

Every other test and screenshot in this repository uses the deterministic `scripted` provider. That
is the right default - the suite must not need a subscription to pass - but it means the numbers in
the demo are simulated arithmetic, not real spend.

**Done when:** a headline number shown in the interface can be traced to a real provider invoice.

### 2. Move secrets out of the database

`ProviderRegistry.setSecret()` writes API keys as plaintext into the `settings` table
(`src/main/runtime/provider-registry.ts`). Anyone with the SQLite file has the key.

This now covers the SMTP password too: `MailService` stores it under `mail.password` through the
same call (`src/main/services/mail-service.ts`), so an email account password is sitting in the same
plaintext table. That makes this item more urgent than it was, not less.

Use Electron's `safeStorage` (`safeStorage.encryptString`) and store the ciphertext, or go to the OS
keychain via `keytar`. `safeStorage` is preferable — no native dependency, and we have had enough of
those.

**Done when:** the key round-trips through the UI, `strings agent-orchestrator.db | grep sk-ant`
finds nothing, and the same holds for the SMTP password.

### 3. Make the shell layer cross-platform

`run_shell`, `run_tests` and the console all hardcode `/bin/sh`
(`src/main/runtime/tools/execution.ts`, `src/main/services/workspace-service.ts`). On Windows every
command fails.

**Done when:** the console runs `echo hi` on Windows, macOS and Linux from the same code path.

---

## P1 — Named in the brief, not built

### 4. More providers, especially the CLI ones

Only `claude-code` and `anthropic-api` exist. The brief specifically wanted **opencode** and
**codex** — the whole "use your existing subscriptions" premise leans on them.

`ProviderAdapter` (`src/main/runtime/provider-types.ts`) is the seam and it is already proven by two
very different implementations: one that hosts its own tool loop, one that hands tool calls back.
A new CLI adapter is mostly argument construction plus output parsing.

Also unbuilt: OpenAI, Google, OpenRouter, local models (Ollama/llama.cpp), custom OpenAI-compatible
endpoints.

**Done when:** an agent configured with `provider: 'opencode'` completes a task, and switching a
project's provider needs no code change.

### 5. Consume external MCP servers

`mcp` is in `TOOL_KINDS` but `ToolRuntime.callCustom()` has no case for it, so it falls through to
"not executable" (`src/main/runtime/tool-runtime.ts`). We *serve* MCP to the CLI; we cannot *use*
anyone else's server.

Wanted: register an MCP server per project (command + args + env), list its tools into a toolkit,
and route calls through the same permission gate.

**Done when:** adding a filesystem or GitHub MCP server puts its tools in a toolkit, and an agent
without the right permission is still refused.

### 6. Import and export (§46 of the brief)

Not started. No way to move a project, agent, workflow or toolkit between machines, and no versioned
schema for doing it.

Suggest: a single `.aoproj` zip — `manifest.json` with a schema version, plus JSON per table, with
ids rewritten on import to avoid collisions.

**Done when:** exporting a project and importing it into a clean install reproduces the fleet, tasks,
workflows, memory and schedules, and the app refuses a file from a newer schema version with a clear
message.

### 7. Notification centre (§52)

Approvals only surface inside the app's dock. If the window is behind your editor, an agent waiting
on you waits forever.

Wanted: OS notifications via Electron's `Notification` for approval requests, judge rejections,
budget warnings, watchdog alerts and project completion — plus a dismissible in-app list with
history. Respect a per-project mute.

**Done when:** an approval request raises an OS notification that focuses the right project when
clicked.

### 8. Budget `fallback` action

`BudgetAction` includes `'fallback'` and the column exists, but nothing implements it — a budget hit
always pauses or asks (`src/main/services/budget-service.ts`, `AgentRuntime.run`).

Implement: on `fallback`, re-run with the cheaper tier from `ProviderRegistry.resolveModel()` and
record that the downgrade happened, rather than stopping the work.

**Done when:** a project whose per-task ceiling is reached continues on a cheaper model, and the
execution row shows which model was actually used and why.

### 9. Workflow `schedule` trigger

Workflows support `manual` and `event`. The `schedule` value is stored but nothing fires it. Today
you need a schedule whose task tells an agent to call `run_workflow`, which is a silly detour.

**Done when:** a workflow with a cron expression fires from `Scheduler` directly, survives a
restart, and honours the same catch-up policy as task schedules.

### 10. Agent heartbeats (§11)

There is no per-agent standing loop. An agent cannot "wake every 15 minutes, check these things, act
if needed" without a schedule creating tasks for it. This is the pulse idea from the brief and it is
what makes a fleet feel alive rather than purely reactive.

Wanted: `heartbeatMs` on an agent, a standing instruction set, and a runner that respects budgets,
skips a beat while the agent is busy, and can be paused per agent.

**Done when:** an agent with a 60s heartbeat produces periodic executions, stops when paused, and
cannot outrun its project budget.

---

## P2 — Built but shallow

### 11. Judge panels and rubrics have no interface

`aggregateVerdicts()` and multi-judge panels work and are unit-tested; `EvaluationService.saveRubric`
exists. Neither is reachable from the UI, so every project silently uses the default rubric and a
single judge.

**Done when:** you can edit dimension weights and thresholds per project, and nominate two or three
agents as a panel whose verdicts are aggregated.

### 12. Memory retrieval is keyword matching

`MemoryService.query()` scores on token overlap, importance and recency. It works, and it is
explainable, but it misses paraphrases entirely. Embeddings would help — ideally local, so the
local-first promise holds.

**Done when:** a memory written as "never edit the raw exports" is retrieved for a task that says
"modify data/raw", and retrieval still works offline.

### 13. Nothing is virtualised

The agent graph, event timeline and task board all render every row. Fine at 20 agents; a 200-agent
fleet with thousands of events will crawl. The §57 performance loop was never run.

**Done when:** 200 agents and 20,000 events stay interactive, with a benchmark script to prove it.

### 14. Workflow editor ergonomics

Click-to-add rather than drag-from-palette. No undo. Branch labels are auto-assigned with no way to
change them, so wiring `false` before `true` leaves you stuck. No copy/paste, no multi-select.

**Done when:** you can build the demo workflow without touching the seed script and without getting
stuck on a mislabelled edge.

---

## P3 — Packaging and housekeeping

### 15. Only macOS is packaged

`build` in `package.json` has a `mac` target and nothing else. No icons, no code signing, no
notarisation, so even the `.dmg` will warn on another machine.

### 16. 24 npm audit vulnerabilities

All in the `electron-builder` dev toolchain, none shipped in the app — but clear them before
distributing anything.

### 17. The renderer bundle is ~7 MB

Monaco is most of it. Trimmed to eleven languages already; `editor.all.js` is the remaining bulk and
dropping it costs find/replace and bracket matching. Irrelevant for a local app, worth revisiting if
startup time suffers.

### 18. Put the UI check in CI

`scripts/e2e-check.mjs` drives the real app through its interface and already caught two bugs the
unit tests could not see. It should run on every change, not when I remember.

---

## Known sharp edges

These are deliberate, not bugs — but they will surprise someone.

- **The native-module dance.** `predev` and `pretest` swap `better-sqlite3` between the Electron and
  Node ABIs (`scripts/ensure-native.mjs`). If you run `npx vitest` directly, bypassing `pretest`, you
  get `Module did not self-register`. Use `npm test`.
- **The console has no PTY.** Interactive programs will not behave as they do in your shell. A real
  terminal means another native module.
- **`npm test` needs Node 20–23.** `better-sqlite3` publishes no prebuilds beyond 23 and cannot
  compile against newer V8. The app is unaffected; it uses Electron's Node.
- **Worktree isolation needs git.** Without a repository, every agent shares one checkout and the
  last writer wins. The setting silently falls back rather than failing.

---

## Where things live

```
src/main/runtime/providers/      provider adapters — start here for new models
src/main/runtime/tools/          tool definitions, one file per toolkit
src/main/runtime/tool-runtime.ts the single permission and approval gate
src/main/engines/                execution manager, scheduler, judge, watchdog, workflows
src/main/services/               persistence and domain logic, one service per concern
src/shared/                      vocabulary shared with the renderer — no Node imports
src/renderer/src/views/          one file per view
scripts/seed-demo.ts             builds a realistic database by running the real loop
scripts/visual-check.mjs         screenshots every view from the running app
scripts/e2e-check.mjs            drives the app through its UI and asserts the result
```
