import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore, type ViewId } from './store'
import { api } from './api'
import { Badge, Button, EmptyState, Kbd, StatusDot, formatCost } from './ui'
import { CommandPalette } from './components/CommandPalette'
import { ActivityDock } from './components/ActivityDock'
import { NewProjectModal } from './components/NewProject'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Dashboard } from './views/Dashboard'
import { AgentsView } from './views/Agents'
import { GraphView } from './views/Graph'
import { TasksView } from './views/Tasks'
import { AutomationView } from './views/Automation'
import { WorkflowsView } from './views/Workflows'
import { WorkspaceView } from './views/Workspace'
import { MemoryView } from './views/Memory'
import { SettingsView } from './views/Settings'

const NAV: Array<{ id: ViewId; label: string; glyph: string }> = [
  { id: 'dashboard', label: 'Dashboard', glyph: '◱' },
  { id: 'agents', label: 'Agents', glyph: '◈' },
  { id: 'graph', label: 'Graph', glyph: '⌗' },
  { id: 'tasks', label: 'Tasks', glyph: '☰' },
  { id: 'workflows', label: 'Workflows', glyph: '⑂' },
  { id: 'automation', label: 'Automation', glyph: '⟳' },
  { id: 'workspace', label: 'Workspace', glyph: '⌘' },
  { id: 'memory', label: 'Memory', glyph: '❖' },
  { id: 'settings', label: 'Settings', glyph: '⚙' }
]

export default function App(): React.JSX.Element {
  const store = useStore()
  const [newProjectOpen, setNewProjectOpen] = useState(false)

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
        store.setDock(!store.dockOpen)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setNewProjectOpen(true)
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
  const runningAgents = store.agents.filter((a) => a.status === 'RUNNING').length

  return (
    <div className="flex h-full w-full flex-col bg-base-900 text-ink">
      {/* Title bar */}
      <header className="drag-region flex h-11 shrink-0 items-center gap-3 border-b border-edge bg-base-850 pl-20 pr-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight">Agent Orchestrator</span>
        </div>

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
            <button
              className="flex items-center gap-1 text-warn hover:text-warn/80"
              onClick={() => store.setDock(true, 'approvals')}
            >
              ⚠ {store.approvals.length} awaiting approval
            </button>
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
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-base-850">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-2xs uppercase tracking-wider text-ink-faint">Projects</span>
            <Button size="sm" variant="ghost" onClick={() => setNewProjectOpen(true)} title="New project (⌘N)">
              ＋
            </Button>
          </div>

          <div className="scroll-y max-h-56 border-b border-edge px-1.5 pb-2">
            {store.projects.length === 0 && (
              <p className="px-2 py-3 text-xs text-ink-faint">No projects yet.</p>
            )}
            {store.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => void store.selectProject(p.id)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm row-hover',
                  p.id === store.activeProjectId ? 'bg-base-750 text-ink' : 'text-ink-dim'
                )}
              >
                <StatusDot status={p.status === 'ACTIVE' ? 'RUNNING' : p.status} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>

          <nav className="flex flex-col gap-0.5 p-1.5">
            {NAV.map((item) => (
              <button
                key={item.id}
                disabled={!project}
                onClick={() => store.setView(item.id)}
                className={clsx(
                  'flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm row-hover disabled:opacity-30',
                  store.view === item.id ? 'bg-base-750 text-ink' : 'text-ink-dim'
                )}
              >
                <span className="w-4 text-center text-ink-faint">{item.glyph}</span>
                {item.label}
                {item.id === 'tasks' && store.stats?.pendingReviews ? (
                  <span className="ml-auto text-2xs text-magic">{store.stats.pendingReviews}</span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex-1" />

          {project && (
            <div className="border-t border-edge p-2">
              <div className="flex gap-1.5">
                {project.status === 'ACTIVE' ? (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => void api.projects.pause(project.id).then(() => store.refreshProjects())}
                  >
                    Pause
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    className="flex-1"
                    onClick={async () => {
                      if (project.status === 'DRAFT') await api.projects.launch(project.id)
                      else await api.projects.resume(project.id)
                      await store.refreshProjects()
                      await store.refreshProject()
                    }}
                  >
                    {project.status === 'DRAFT'
                      ? 'Launch'
                      : project.status === 'COMPLETED'
                        ? 'Reopen'
                        : project.status === 'REVIEW'
                          ? 'Continue'
                          : 'Resume'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* Main */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
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
            ) : (
              <ErrorBoundary key={store.view}>
                <ViewRouter view={store.view} />
              </ErrorBoundary>
            )}
          </div>

          {project && <ActivityDock />}
        </main>
      </div>

      {store.error && (
        <div className="border-t border-bad/40 bg-bad/10 px-3 py-1.5 text-xs text-bad">
          {store.error}
          <button className="ml-2 underline" onClick={() => useStore.setState({ error: null })}>
            dismiss
          </button>
        </div>
      )}

      <CommandPalette onNewProject={() => setNewProjectOpen(true)} />
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  )
}

function ViewRouter({ view }: { view: ViewId }): React.JSX.Element {
  switch (view) {
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
