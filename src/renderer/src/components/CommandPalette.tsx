import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore, type ViewId } from '../store'
import { api } from '../api'
import { Kbd } from '../ui'

interface Command {
  id: string
  label: string
  hint?: string
  group: string
  run(): void | Promise<void>
}

export function CommandPalette({ onNewProject }: { onNewProject(): void }): React.JSX.Element | null {
  const store = useStore()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (store.paletteOpen) {
      setQuery('')
      setIndex(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [store.paletteOpen])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    const go = (view: ViewId, label: string): Command => ({
      id: `view:${view}`,
      label,
      group: 'Navigate',
      run: () => store.setView(view)
    })

    list.push(
      go('dashboard', 'Open dashboard'),
      go('agents', 'Open agents'),
      go('graph', 'Open agent graph'),
      go('tasks', 'Open task board'),
      go('automation', 'Open automation'),
      go('workflows', 'Open workflows'),
      go('workspace', 'Open workspace'),
      go('memory', 'Open memory'),
      go('settings', 'Open settings')
    )

    list.push({
      id: 'project:new',
      label: 'Create project',
      hint: '⌘N',
      group: 'Create',
      run: onNewProject
    })

    const project = store.projects.find((p) => p.id === store.activeProjectId)
    if (project) {
      list.push({
        id: 'project:launch',
        label: `Launch the Orchestrator on "${project.name}"`,
        group: 'Run',
        run: async () => {
          await api.projects.launch(project.id)
          await store.refreshProject()
        }
      })
      list.push({
        id: 'project:pause',
        label: 'Pause this project',
        group: 'Run',
        run: async () => {
          await api.projects.pause(project.id)
          await store.refreshProjects()
        }
      })
      list.push({
        id: 'project:resume',
        label: 'Resume this project',
        group: 'Run',
        run: async () => {
          await api.projects.resume(project.id)
          await store.refreshProjects()
        }
      })
    }

    for (const p of store.projects) {
      list.push({
        id: `open:${p.id}`,
        label: `Switch to ${p.name}`,
        group: 'Projects',
        run: () => void store.selectProject(p.id)
      })
    }

    for (const agent of store.agents) {
      list.push({
        id: `agent:${agent.id}`,
        label: `Inspect ${agent.name}`,
        hint: agent.role,
        group: 'Agents',
        run: () => {
          store.selectAgent(agent.id)
          store.setView('agents')
        }
      })
      if (agent.status === 'PAUSED') {
        list.push({
          id: `agent:resume:${agent.id}`,
          label: `Resume ${agent.name}`,
          group: 'Agents',
          run: async () => {
            await api.agents.setStatus(agent.id, 'IDLE')
          }
        })
      } else if (!['RUNNING'].includes(agent.status)) {
        list.push({
          id: `agent:pause:${agent.id}`,
          label: `Pause ${agent.name}`,
          group: 'Agents',
          run: async () => {
            await api.agents.setStatus(agent.id, 'PAUSED')
          }
        })
      }
    }

    for (const task of store.tasks.slice(0, 60)) {
      list.push({
        id: `task:${task.id}`,
        label: `Open task: ${task.title}`,
        hint: task.status,
        group: 'Tasks',
        run: () => {
          store.selectTask(task.id)
          store.setView('tasks')
        }
      })
      if (['READY', 'BACKLOG', 'BLOCKED', 'FAILED'].includes(task.status) && task.agentId) {
        list.push({
          id: `task:run:${task.id}`,
          label: `Run task: ${task.title}`,
          group: 'Tasks',
          run: () => void api.tasks.run(task.id)
        })
      }
    }

    return list
  }, [store, onNewProject])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands.slice(0, 40)
    return commands
      .map((command) => {
        const haystack = `${command.group} ${command.label} ${command.hint ?? ''}`.toLowerCase()
        const position = haystack.indexOf(needle)
        return { command, score: position < 0 ? Infinity : position }
      })
      .filter((r) => r.score !== Infinity)
      .sort((a, b) => a.score - b.score)
      .slice(0, 40)
      .map((r) => r.command)
  }, [commands, query])

  if (!store.paletteOpen) return null

  const runAt = (i: number): void => {
    const command = results[i]
    if (!command) return
    store.setPalette(false)
    void command.run()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-24 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) store.setPalette(false)
      }}
    >
      <div className="panel w-full max-w-xl overflow-hidden bg-base-850 shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runAt(index)
            } else if (e.key === 'Escape') {
              store.setPalette(false)
            }
          }}
          placeholder="Type a command, agent or task…"
          className="w-full rounded-none border-0 border-b border-edge bg-transparent px-4 py-3 text-md"
        />
        <div className="scroll-y max-h-96">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">No matches.</p>
          )}
          {results.map((command, i) => (
            <button
              key={command.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
              className={clsx(
                'flex w-full items-center gap-3 px-4 py-2 text-left text-sm',
                i === index ? 'bg-base-750' : 'hover:bg-base-800'
              )}
            >
              <span className="w-20 shrink-0 text-2xs uppercase tracking-wider text-ink-faint">
                {command.group}
              </span>
              <span className="min-w-0 flex-1 truncate">{command.label}</span>
              {command.hint && <Kbd>{command.hint}</Kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
