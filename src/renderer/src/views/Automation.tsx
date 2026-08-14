import React, { useEffect, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, Field, Modal, Panel, Tabs, formatRelative } from '../ui'
import type { Tool, Toolkit } from '@shared/models'

export function AutomationView(): React.JSX.Element {
  const [tab, setTab] = useState<'schedules' | 'tools'>('schedules')
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'schedules', label: 'Schedules' },
            { id: 'tools', label: 'Tools & toolkits' }
          ]}
        />
      </header>
      <div className="scroll-y min-h-0 flex-1 p-3">
        {tab === 'schedules' ? <Schedules /> : <Tools />}
      </div>
    </div>
  )
}

function describe(schedule: {
  kind: string
  cron: string | null
  intervalMs: number | null
  runAt: number | null
  eventType: string | null
}): string {
  switch (schedule.kind) {
    case 'cron':
      return `cron ${schedule.cron}`
    case 'interval':
      return `every ${Math.round((schedule.intervalMs ?? 0) / 1000)}s`
    case 'once':
      return `once at ${schedule.runAt ? new Date(schedule.runAt).toLocaleString() : '—'}`
    case 'event':
      return `on ${schedule.eventType}`
    default:
      return schedule.kind
  }
}

function Schedules(): React.JSX.Element {
  const store = useStore()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <Panel
        title={`Schedules · ${store.schedules.length}`}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            New schedule
          </Button>
        }
        dense
      >
        {store.schedules.length === 0 ? (
          <p className="p-3 text-xs text-ink-faint">
            Nothing scheduled. Schedules are stored in the database, so they survive restarts and
            replay what they missed while the app was closed.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-2xs uppercase tracking-wider text-ink-faint">
                <th className="px-3 py-1.5 text-left font-medium">Name</th>
                <th className="px-3 py-1.5 text-left font-medium">Trigger</th>
                <th className="px-3 py-1.5 text-left font-medium">Agent</th>
                <th className="px-3 py-1.5 text-left font-medium">Next</th>
                <th className="px-3 py-1.5 text-left font-medium">Runs</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {store.schedules.map((schedule) => (
                <tr key={schedule.id} className="border-b border-edge-soft row-hover">
                  <td className="px-3 py-1.5">
                    {schedule.name}
                    {!schedule.enabled && (
                      <Badge className="ml-2" tone="neutral">
                        disabled
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 mono text-xs text-ink-dim">{describe(schedule)}</td>
                  <td className="px-3 py-1.5 text-xs text-ink-dim">
                    {store.agents.find((a) => a.id === schedule.agentId)?.name ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-ink-dim">
                    {schedule.nextRunAt ? formatRelative(schedule.nextRunAt) : 'on event'}
                  </td>
                  <td className="px-3 py-1.5 mono text-xs tabular-nums text-ink-dim">
                    {schedule.runCount}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void api.schedules.runNow(schedule.id)}
                      >
                        Run now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.schedules.setEnabled(schedule.id, !schedule.enabled)
                        }
                      >
                        {schedule.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void api.schedules.remove(schedule.id).then(() => store.refreshProject())
                        }
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <NewScheduleModal open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

function NewScheduleModal({
  open,
  onClose
}: {
  open: boolean
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [kind, setKind] = useState<'cron' | 'interval' | 'once' | 'event'>('cron')
  const [cron, setCron] = useState('0 9 * * 1-5')
  const [intervalMinutes, setIntervalMinutes] = useState(60)
  const [runAt, setRunAt] = useState('')
  const [eventType, setEventType] = useState('TASK_FAILED')
  const [agentId, setAgentId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [catchupPolicy, setCatchupPolicy] = useState('run_once')
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    setError(null)
    try {
      await api.schedules.create({
        projectId: store.activeProjectId,
        agentId: agentId || null,
        name: title,
        kind,
        cron: kind === 'cron' ? cron : null,
        intervalMs: kind === 'interval' ? intervalMinutes * 60_000 : null,
        runAt: kind === 'once' && runAt ? new Date(runAt).getTime() : null,
        eventType: kind === 'event' ? eventType : null,
        catchupPolicy,
        taskTemplate: { title, description, agentId: agentId || null }
      })
      await store.refreshProject()
      setTitle('')
      setDescription('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Modal open={open} title="New schedule" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Task title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Instructions for each run">
          <textarea value={description} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Trigger">
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="cron">Cron</option>
              <option value="interval">Interval</option>
              <option value="once">Once</option>
              <option value="event">On event</option>
            </select>
          </Field>
          <Field label="Assign to">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Unassigned</option>
              {store.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {kind === 'cron' && (
          <Field label="Cron expression" hint="Five fields, local time. Example: 0 9 * * 1-5">
            <input value={cron} onChange={(e) => setCron(e.target.value)} className="mono" />
          </Field>
        )}
        {kind === 'interval' && (
          <Field label="Every (minutes)">
            <input
              type="number"
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            />
          </Field>
        )}
        {kind === 'once' && (
          <Field label="Run at">
            <input
              type="datetime-local"
              value={runAt}
              onChange={(e) => setRunAt(e.target.value)}
            />
          </Field>
        )}
        {kind === 'event' && (
          <Field label="Event type" hint="Any event the system emits, e.g. TASK_FAILED.">
            <input
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="mono"
            />
          </Field>
        )}

        <Field
          label="If the app was closed"
          hint="What to do about firings that were missed while the application was not running."
        >
          <select value={catchupPolicy} onChange={(e) => setCatchupPolicy(e.target.value)}>
            <option value="run_once">Run once to catch up</option>
            <option value="run_all">Run every missed firing</option>
            <option value="skip">Skip them</option>
          </select>
        </Field>

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!title.trim()} onClick={() => void submit()}>
            Create schedule
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Tools(): React.JSX.Element {
  const store = useStore()
  const [toolkits, setToolkits] = useState<Toolkit[]>([])
  const [tools, setTools] = useState<Record<string, Tool[]>>({})
  const [creating, setCreating] = useState(false)

  const load = async (): Promise<void> => {
    if (!store.activeProjectId) return
    const kits = await api.tools.toolkits(store.activeProjectId)
    setToolkits(kits)
    const entries = await Promise.all(
      kits.map(async (kit) => [kit.id, await api.tools.list(kit.id)] as const)
    )
    setTools(Object.fromEntries(entries))
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activeProjectId])

  return (
    <>
      <div className="mb-2 flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          New tool
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {toolkits.map((kit) => (
          <Panel
            key={kit.id}
            title={
              <span className="flex items-center gap-2">
                {kit.name}
                {kit.isBuiltIn ? <Badge>built-in</Badge> : <Badge tone="accent">project</Badge>}
              </span>
            }
            dense
          >
            <p className="px-3 py-1.5 text-xs text-ink-faint">{kit.description}</p>
            <div className="border-t border-edge-soft">
              {(tools[kit.id] ?? []).map((tool) => (
                <div key={tool.id} className="px-3 py-1.5 row-hover">
                  <div className="flex items-center gap-2">
                    <span className="mono text-xs">{tool.name}</span>
                    <span className="text-2xs text-ink-faint">{tool.kind}</span>
                    <div className="flex-1" />
                    {tool.requiredPermissions.map((p) => (
                      <span key={p} className="mono text-2xs text-ink-faint">
                        {p}
                      </span>
                    ))}
                    {!tool.isBuiltIn && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void api.tools.remove(tool.id).then(load)}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-ink-faint">{tool.description}</p>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      <NewToolModal
        open={creating}
        onClose={() => {
          setCreating(false)
          void load()
        }}
      />
    </>
  )
}

function NewToolModal({ open, onClose }: { open: boolean; onClose(): void }): React.JSX.Element {
  const store = useStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'shell' | 'http' | 'javascript'>('shell')
  const [implementation, setImplementation] = useState('')
  const [parameters, setParameters] = useState('')
  const [toolkitName, setToolkitName] = useState('Project tools')
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    setError(null)
    try {
      await api.tools.create({
        projectId: store.activeProjectId,
        toolkitName,
        name,
        description,
        kind,
        implementation,
        parameters: parameters
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      })
      setName('')
      setImplementation('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const hints: Record<string, string> = {
    shell: 'Shell command. Use {{param}} placeholders, e.g. npm run build -- {{target}}',
    http: 'METHOD and URL, e.g. GET https://api.example.com/status/{{id}}',
    javascript: 'A function body receiving `input` and returning a value. No filesystem or network.'
  }

  return (
    <Modal open={open} title="New tool" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" hint="snake_case">
            <input value={name} onChange={(e) => setName(e.target.value)} className="mono" />
          </Field>
          <Field label="Toolkit">
            <input value={toolkitName} onChange={(e) => setToolkitName(e.target.value)} />
          </Field>
        </div>
        <Field label="Description" hint="What it does and when an agent should reach for it.">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="shell">Shell</option>
            <option value="http">HTTP</option>
            <option value="javascript">JavaScript</option>
          </select>
        </Field>
        <Field label="Implementation" hint={hints[kind]}>
          <textarea
            value={implementation}
            rows={5}
            onChange={(e) => setImplementation(e.target.value)}
            className="mono"
          />
        </Field>
        <Field label="Parameters" hint="Comma separated names used as {{placeholders}}.">
          <input value={parameters} onChange={(e) => setParameters(e.target.value)} />
        </Field>
        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !implementation.trim()}
            onClick={() => void submit()}
          >
            Create tool
          </Button>
        </div>
      </div>
    </Modal>
  )
}
