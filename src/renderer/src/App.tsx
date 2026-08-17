import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore, type DocTab } from './store'
import { Badge, Button, EmptyState, Kbd, StatusDot, formatCost, formatTokens } from './ui'
import { CommandPalette } from './components/CommandPalette'
import { NewProjectModal } from './components/NewProject'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ProjectRail } from './components/ProjectRail'
import { TeamChat } from './components/TeamChat'
import { AttentionBar } from './components/AttentionBar'
import { SessionsRail } from './components/SessionsRail'
import { ToolkitPanel } from './components/ToolkitPanel'
import { Terminal } from './components/Terminal'
import { DocTabs } from './components/DocTabs'
import { Resizer } from './components/Resizer'
import { ProjectReport } from './views/ProjectReport'
import { AgentDoc } from './views/AgentDoc'
import { FloorView } from './views/FloorView'
import { AgentsView } from './views/Agents'
import { GraphView } from './views/Graph'
import { TasksView } from './views/Tasks'
import { AutomationView } from './views/Automation'
import { WorkflowsView } from './views/Workflows'
import { WorkspaceView } from './views/Workspace'
import { MemoryView } from './views/Memory'
import { SettingsView } from './views/Settings'
import { Dashboard } from './views/Dashboard'

/**
 * The workbench.
 *
 *   projects │ document       │ sessions
 *            │ ─────────────  │ ────────
 *   chat     │ terminal       │ toolkit
 *
 * Three columns rather than a navigation rail and one big pane. The left column
 * answers "what am I working on", the centre "what is it doing", the right "who
 * is doing it" - and the two docked panes are the things you keep reaching for
 * while reading the middle: a shell, and the selected agent's actual reach.
 */
export default function App(): React.JSX.Element {
  const store = useStore()
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(236)
  const [rightWidth, setRightWidth] = useState(320)
  const [terminalHeight, setTerminalHeight] = useState(200)
  const [toolkitHeight, setToolkitHeight] = useState(260)

  useEffect(() => {
    void store.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        store.setPalette(!store.paletteOpen)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        store.setTerminal(!store.terminalOpen)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewProjectOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w' && store.activeTabId) {
        e.preventDefault()
        store.closeTab(store.activeTabId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  useEffect(() => {
    return window.ao.onEvent((raw) => {
      const event = raw as { type?: string; data?: { command?: string } }
      if (event?.type !== 'UI_COMMAND') return
      if (event.data?.command === 'palette.open') store.setPalette(true)
      if (event.data?.command === 'project.new') setNewProjectOpen(true)
    })
  }, [store])

  const project = store.projects.find((p) => p.id === store.activeProjectId) ?? null
  const runningAgents = store.fleet.agents.filter((a) => a.status === 'RUNNING').length
  const activeTab = store.tabs.find((t) => t.id === store.activeTabId) ?? null

  return (
    <div className="flex h-full w-full flex-col bg-base-900 text-ink">
      <header className="drag-region flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-base-850 pl-20 pr-3">
        <span className="text-sm font-semibold tracking-tight">Agent Orchestrator</span>

        {project && (
          <>
            <span className="text-ink-faint">/</span>
            <span className="text-sm text-ink-dim">{project.name}</span>
            <Badge
              tone={
                project.status === 'ACTIVE'
                  ? 'good'
                  : project.status === 'COMPLETED'
                    ? 'accent'
                    : project.status === 'PAUSED'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {project.status}
            </Badge>
          </>
        )}

        <div className="flex-1" />

        <div className="no-drag flex items-center gap-3 text-xs text-ink-faint">
          {store.approvals.length > 0 && (
            <span className="flex items-center gap-1 text-warn">
              ⚠ {store.approvals.length} awaiting approval
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <StatusDot status={runningAgents ? 'RUNNING' : 'IDLE'} />
            {runningAgents} running
          </span>
          {store.stats && <span className="tabular-nums">{formatCost(store.stats.costUsd)}</span>}
          <button
            className="flex items-center gap-1 hover:text-ink-dim"
            onClick={() => store.setPalette(true)}
          >
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left: projects, chat, attention */}
        <aside
          data-pane="projects"
          className="flex shrink-0 flex-col border-r border-edge bg-base-850"
          style={{ width: leftWidth }}
        >
          <div className="min-h-0 flex-1">
            <ProjectRail onNewProject={() => setNewProjectOpen(true)} />
          </div>
          <TeamChat />
          <AttentionBar />
        </aside>

        <Resizer direction="col" value={leftWidth} min={180} max={420} onResize={setLeftWidth} />

        {/* Centre: document, tabs, terminal */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div data-pane="document" className="min-h-0 flex-1 overflow-hidden bg-base-900">
            {!store.ready ? (
              <EmptyState title="Starting up…" />
            ) : !project ? (
              <EmptyState
                title="No project selected"
                detail="Create a project, give it a mission, and the Orchestrator will work out which agents it needs."
                action={
                  <Button variant="primary" onClick={() => setNewProjectOpen(true)}>
                    New project
                  </Button>
                }
              />
            ) : !activeTab ? (
              <EmptyState
                title="Nothing open"
                detail="Pick something from the project on the left, or an agent on the right."
              />
            ) : (
              <ErrorBoundary key={activeTab.id}>
                <TabPane tab={activeTab} />
              </ErrorBoundary>
            )}
          </div>

          {project && <DocTabs />}

          {project && store.terminalOpen && (
            <>
              <Resizer
                direction="row"
                value={terminalHeight}
                min={80}
                max={560}
                invert
                onResize={setTerminalHeight}
              />
              <div
                data-pane="terminal"
                className="shrink-0 border-t border-edge"
                style={{ height: terminalHeight }}
              >
                <Terminal projectId={project.id} />
              </div>
            </>
          )}

          {project && !store.terminalOpen && (
            <button
              className="flex h-6 shrink-0 items-center gap-2 border-t border-edge bg-base-850 px-3 text-2xs uppercase tracking-wider text-ink-faint hover:text-ink-dim"
              onClick={() => store.setTerminal(true)}
            >
              Terminal <Kbd>⌘J</Kbd>
            </button>
          )}
        </main>

        <Resizer
          direction="col"
          value={rightWidth}
          min={240}
          max={520}
          invert
          onResize={setRightWidth}
        />

        {/* Right: sessions and the selected agent's toolkit */}
        <aside
          className="flex shrink-0 flex-col border-l border-edge bg-base-850"
          style={{ width: rightWidth }}
        >
          <div data-pane="sessions" className="min-h-0 flex-1">
            <SessionsRail />
          </div>
          <Resizer
            direction="row"
            value={toolkitHeight}
            min={38}
            max={620}
            invert
            onResize={setToolkitHeight}
          />
          <div data-pane="toolkit" className="shrink-0" style={{ height: toolkitHeight }}>
            <ToolkitPanel />
          </div>
          <StatusStrip />
        </aside>
      </div>

      {store.error && (
        <div className="flex shrink-0 items-center gap-2 border-t border-bad/40 bg-bad/10 px-3 py-1.5 text-xs text-bad">
          <span className="flex-1">{store.error}</span>
          <button className="underline" onClick={() => useStore.setState({ error: null })}>
            dismiss
          </button>
        </div>
      )}

      <CommandPalette onNewProject={() => setNewProjectOpen(true)} />
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  )
}

/**
 * A one-line footing for the fleet: how much is moving, how much it has cost,
 * and whether the provider is actually there. Small enough to ignore, present
 * enough that "is anything running?" never needs a click.
 */
function StatusStrip(): React.JSX.Element {
  const store = useStore()

  const running = store.fleet.agents.filter((a) => a.status === 'RUNNING').length
  const blocked = store.fleet.agents.filter((a) => a.status === 'BLOCKED').length
  const spend = store.fleet.agents.reduce((sum, a) => sum + a.costUsd, 0)
  const tokens = store.fleet.agents.reduce((sum, a) => sum + a.tokens, 0)
  const provider = store.providers.find((p) => p.availability?.available)

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-edge bg-base-900 px-3 text-2xs text-ink-faint">
      <span className="flex items-center gap-1">
        <StatusDot status={running ? 'RUNNING' : 'IDLE'} />
        <span className="tabular-nums">{running}</span> running
      </span>
      {blocked > 0 && (
        <span className="text-warn">
          <span className="tabular-nums">{blocked}</span> blocked
        </span>
      )}
      <span className="tabular-nums">{formatCost(spend)}</span>
      <span className="tabular-nums">{formatTokens(tokens)}</span>
      <span className="flex-1" />
      <span
        className="truncate"
        title={provider?.availability?.detail ?? 'No provider is available.'}
      >
        {provider ? provider.label : 'no provider'}
      </span>
      <span className={clsx('h-1.5 w-1.5 rounded-full', provider ? 'bg-good' : 'bg-bad')} />
    </div>
  )
}

function TabPane({ tab }: { tab: DocTab }): React.JSX.Element {
  if (tab.kind === 'report') return <ProjectReport projectId={tab.projectId} />
  if (tab.kind === 'agent') return <AgentDoc agentId={tab.agentId} />

  switch (tab.view) {
    case 'floor':
      return <FloorView projectId={tab.projectId} />
    case 'agents':
      return <AgentsView />
    case 'graph':
      return <GraphView />
    case 'tasks':
      return <TasksView />
    case 'automation':
      return <AutomationView />
    case 'workflows':
      return <WorkflowsView />
    case 'workspace':
      return <WorkspaceView />
    case 'memory':
      return <MemoryView />
    case 'settings':
      return <SettingsView />
    default:
      return <Dashboard />
  }
}
