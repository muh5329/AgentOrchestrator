import React, { useState } from 'react'
import clsx from 'clsx'
import { useStore, type ViewId } from '../store'
import { api } from '../api'
import { Button, StatusDot } from '../ui'
import type { Project } from '@shared/models'

/**
 * Projects on the left, each expanding into the surfaces that belong to it.
 *
 * The old build put those surfaces in a global navigation rail, which quietly
 * implied they were application-level when every one of them is scoped to a
 * single project. Hanging them under the project they belong to says the true
 * thing and removes a column.
 */

const SECTIONS: Array<{ view: ViewId; label: string; glyph: string }> = [
  { view: 'graph', label: 'Graph', glyph: '⌗' },
  { view: 'agents', label: 'Agents', glyph: '◈' },
  { view: 'tasks', label: 'Tasks', glyph: '☰' },
  { view: 'workflows', label: 'Workflows', glyph: '⑂' },
  { view: 'automation', label: 'Automation', glyph: '⟳' },
  { view: 'workspace', label: 'Workspace', glyph: '⌘' },
  { view: 'memory', label: 'Memory', glyph: '❖' },
  { view: 'settings', label: 'Settings', glyph: '⚙' }
]

export function ProjectRail({ onNewProject }: { onNewProject(): void }): React.JSX.Element {
  const store = useStore()
  const [filter, setFilter] = useState('')

  const query = filter.trim().toLowerCase()
  const projects = query
    ? store.projects.filter(
        (p) => p.name.toLowerCase().includes(query) || p.mission.toLowerCase().includes(query)
      )
    : store.projects

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2">
        <span className="text-2xs uppercase tracking-wider text-ink-faint">Projects</span>
        <Button size="sm" variant="ghost" onClick={onNewProject} title="New project (⌘N)">
          ＋
        </Button>
      </div>

      <div className="shrink-0 px-2 pb-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter projects…"
          className="h-7 w-full text-xs"
        />
      </div>

      <div className="scroll-y min-h-0 flex-1 pb-2">
        {store.projects.length === 0 && (
          <p className="px-3 py-4 text-xs text-ink-faint">
            No projects yet. Give one a mission and the Orchestrator works out the fleet.
          </p>
        )}
        {projects.map((project) => (
          <ProjectNode key={project.id} project={project} />
        ))}
      </div>
    </div>
  )
}

function ProjectNode({ project }: { project: Project }): React.JSX.Element {
  const store = useStore()
  const isActive = store.activeProjectId === project.id
  const [expanded, setExpanded] = useState(false)
  const open = isActive || expanded

  const select = async (): Promise<void> => {
    if (!isActive) await store.selectProject(project.id)
    setExpanded(true)
  }

  return (
    <div>
      <div
        className={clsx(
          'flex items-center gap-1 pr-2 row-hover',
          isActive ? 'bg-base-750' : 'hover:bg-base-800'
        )}
      >
        <button
          className="w-4 shrink-0 py-1.5 pl-2 text-2xs text-ink-faint"
          onClick={() => setExpanded((e) => !e)}
          title={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          onClick={() => void select()}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
        >
          <StatusDot status={project.status === 'ACTIVE' ? 'RUNNING' : project.status} />
          <span className={clsx('truncate text-sm', isActive ? 'text-ink' : 'text-ink-dim')}>
            {project.name}
          </span>
        </button>
      </div>

      {open && (
        <div className="mb-1">
          <SectionRow
            label="Report"
            glyph="◱"
            active={store.activeTabId === `report:${project.id}`}
            onClick={async () => {
              if (!isActive) await store.selectProject(project.id)
              store.openTab({ kind: 'report', projectId: project.id, title: 'Report' })
            }}
          />
          {SECTIONS.map((section) => (
            <SectionRow
              key={section.view}
              label={section.label}
              glyph={section.glyph}
              badge={
                section.view === 'tasks' && isActive && store.stats?.pendingReviews
                  ? store.stats.pendingReviews
                  : undefined
              }
              active={store.activeTabId === `view:${project.id}:${section.view}`}
              onClick={async () => {
                if (!isActive) await store.selectProject(project.id)
                store.openTab({
                  kind: 'view',
                  projectId: project.id,
                  view: section.view,
                  title: section.label
                })
              }}
            />
          ))}

          {isActive && <ProjectControl project={project} />}
        </div>
      )}
    </div>
  )
}

function SectionRow({
  label,
  glyph,
  badge,
  active,
  onClick
}: {
  label: string
  glyph: string
  badge?: number
  active: boolean
  onClick(): void | Promise<void>
}): React.JSX.Element {
  return (
    <button
      onClick={() => void onClick()}
      className={clsx(
        'flex w-full items-center gap-2 py-1 pl-8 pr-3 text-left text-xs row-hover',
        active ? 'bg-base-750 text-ink' : 'text-ink-dim'
      )}
    >
      <span className="w-3 text-center text-ink-faint">{glyph}</span>
      {label}
      {badge ? <span className="ml-auto text-2xs text-magic">{badge}</span> : null}
    </button>
  )
}

function ProjectControl({ project }: { project: Project }): React.JSX.Element {
  const store = useStore()

  const label =
    project.status === 'DRAFT'
      ? 'Launch'
      : project.status === 'COMPLETED'
        ? 'Reopen'
        : project.status === 'REVIEW'
          ? 'Continue'
          : 'Resume'

  return (
    <div className="px-3 pb-1 pt-1.5">
      {project.status === 'ACTIVE' ? (
        <Button
          size="sm"
          className="w-full"
          onClick={() => void api.projects.pause(project.id).then(() => store.refreshProjects())}
        >
          Pause
        </Button>
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={async () => {
            if (project.status === 'DRAFT') await api.projects.launch(project.id)
            else await api.projects.resume(project.id)
            await store.refreshProjects()
            await store.refreshProject()
          }}
        >
          {label}
        </Button>
      )}
    </div>
  )
}
