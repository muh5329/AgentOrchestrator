import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import { useStore } from '../store'
import { api } from '../api'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Panel,
  StatusDot,
  Tabs,
  formatDuration,
  formatRelative
} from '../ui'
import {
  WORKFLOW_NODES,
  type WorkflowNodeKind,
  type WorkflowValidationIssue
} from '@shared/workflow'
import type { Workflow, WorkflowNodeRun, WorkflowRun } from '@shared/models'

const TONE_BORDER: Record<string, string> = {
  neutral: 'border-edge',
  accent: 'border-accent/50',
  good: 'border-good/50',
  warn: 'border-warn/50',
  magic: 'border-magic/50'
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-ink-dim',
  accent: 'text-accent',
  good: 'text-good',
  warn: 'text-warn',
  magic: 'text-magic'
}

interface NodeData extends Record<string, unknown> {
  kind: WorkflowNodeKind
  label: string
  config: Record<string, unknown>
  runStatus?: string
}

function WorkflowNodeCard({ data, selected }: NodeProps): React.JSX.Element {
  const nodeData = data as NodeData
  const spec = WORKFLOW_NODES[nodeData.kind]
  const summary = summarise(nodeData)

  return (
    <div
      className={clsx(
        'w-[190px] rounded-lg border bg-base-850 px-2.5 py-2 shadow-lg',
        selected ? 'border-accent' : TONE_BORDER[spec.tone],
        nodeData.runStatus === 'RUNNING' && 'running-pulse',
        nodeData.runStatus === 'FAILED' && 'border-bad'
      )}
    >
      {nodeData.kind !== 'start' && <Handle type="target" position={Position.Top} />}
      <div className="flex items-center gap-1.5">
        <span className={clsx('text-sm', TONE_TEXT[spec.tone])}>{spec.glyph}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{nodeData.label}</span>
        {nodeData.runStatus && (
          <StatusDot status={nodeData.runStatus === 'COMPLETED' ? 'COMPLETED' : nodeData.runStatus} />
        )}
      </div>
      <div className="mt-0.5 truncate text-2xs text-ink-faint">{summary || spec.label}</div>
      {nodeData.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}

function summarise(data: NodeData): string {
  const config = data.config ?? {}
  switch (data.kind) {
    case 'agent':
      return `${config.agent ?? '?'} · ${String(config.task ?? '')}`.slice(0, 44)
    case 'task':
      return String(config.title ?? '')
    case 'tool':
      return String(config.tool ?? '')
    case 'condition':
      return String(config.expression ?? '')
    case 'delay':
      return `${config.ms ?? 1000}ms`
    case 'loop':
      return `max ${config.maxIterations ?? 5}`
    case 'webhook':
      return `${config.method ?? 'GET'} ${config.url ?? ''}`.slice(0, 40)
    case 'approval':
      return String(config.action ?? '')
    default:
      return ''
  }
}

const nodeTypes = { wf: WorkflowNodeCard }

export function WorkflowsView(): React.JSX.Element {
  const store = useStore()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!store.activeProjectId) return
    const rows = await api.workflows.list(store.activeProjectId)
    setWorkflows(rows)
    setSelectedId((current) => current ?? rows[0]?.id ?? null)
  }, [store.activeProjectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-edge">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="text-2xs uppercase tracking-wider text-ink-faint">
            Workflows · {workflows.length}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            ＋
          </Button>
        </div>
        <div className="scroll-y flex-1 p-1">
          {workflows.length === 0 && (
            <p className="px-2 py-3 text-xs text-ink-faint">
              No workflows yet. A workflow is a reusable procedure agents and schedules can run.
            </p>
          )}
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              onClick={() => setSelectedId(workflow.id)}
              className={clsx(
                'flex w-full flex-col rounded px-2 py-1.5 text-left row-hover',
                workflow.id === selectedId ? 'bg-base-750' : ''
              )}
            >
              <span className="flex items-center gap-1.5">
                <StatusDot status={workflow.enabled ? 'IDLE' : 'PAUSED'} />
                <span className="min-w-0 flex-1 truncate text-sm">{workflow.name}</span>
              </span>
              <span className="truncate pl-3 text-2xs text-ink-faint">
                {workflow.trigger === 'event' ? `on ${workflow.eventType}` : workflow.trigger}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selectedId ? (
          <WorkflowEditor key={selectedId} workflowId={selectedId} onChanged={load} />
        ) : (
          <EmptyState
            title="No workflow selected"
            detail="Workflows wire agents, tools, conditions and approvals into a procedure you can run on demand, on a schedule, or from an event."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                New workflow
              </Button>
            }
          />
        )}
      </div>

      <NewWorkflowModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (workflowId) => {
          await load()
          setSelectedId(workflowId)
        }}
      />
    </div>
  )
}

function WorkflowEditor({
  workflowId,
  onChanged
}: {
  workflowId: string
  onChanged(): void
}): React.JSX.Element {
  const store = useStore()
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [issues, setIssues] = useState<WorkflowValidationIssue[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null)
  const [nodeRuns, setNodeRuns] = useState<WorkflowNodeRun[]>([])
  const [tab, setTab] = useState<'design' | 'runs'>('design')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)

  const load = useCallback(async () => {
    const graph = await api.workflows.graph(workflowId)
    setWorkflow(graph.workflow)
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'wf',
        position: { x: n.x, y: n.y },
        data: { kind: n.kind as WorkflowNodeKind, label: n.label, config: n.config }
      }))
    )
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        label: e.label ?? undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4d4136' },
        labelStyle: { fill: '#b3a595', fontSize: 10 },
        labelBgStyle: { fill: '#151210' },
        style: { stroke: '#4d4136', strokeWidth: 1.5 }
      }))
    )
    setIssues(await api.workflows.validate(workflowId))
    setRuns(await api.workflows.runs(store.activeProjectId as string, workflowId))
    setDirty(false)
  }, [workflowId, setNodes, setEdges, store.activeProjectId])

  useEffect(() => {
    void load()
  }, [load])

  // Live node highlighting while a run is in flight.
  useEffect(() => {
    return window.ao.onEvent(async (raw) => {
      const event = raw as { type?: string; data?: Record<string, unknown> }
      if (!event.type?.startsWith('WORKFLOW_')) return
      if (activeRun && event.data?.runId !== activeRun.id) return
      if (event.type === 'WORKFLOW_NODE_STARTED' || event.type === 'WORKFLOW_NODE_COMPLETED') {
        const nodeId = String(event.data?.nodeId ?? '')
        setNodes((current) =>
          current.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    runStatus: event.type === 'WORKFLOW_NODE_STARTED' ? 'RUNNING' : 'COMPLETED'
                  }
                }
              : n
          )
        )
      }
    })
  }, [activeRun, setNodes])

  const addNode = (kind: WorkflowNodeKind): void => {
    counter.current += 1
    const id = `new_${Date.now()}_${counter.current}`
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'wf',
        position: { x: 120 + (current.length % 4) * 210, y: 120 + Math.floor(current.length / 4) * 140 },
        data: { kind, label: WORKFLOW_NODES[kind].label, config: defaultConfig(kind) }
      }
    ])
    setSelected(id)
    setDirty(true)
  }

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((n) => n.id === connection.source)
      const kind = (source?.data as NodeData | undefined)?.kind
      const branches = kind ? WORKFLOW_NODES[kind].branches : []
      const used = edges.filter((e) => e.source === connection.source).map((e) => e.label)
      const label = branches.find((b) => !used.includes(b))

      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `new_edge_${Date.now()}`,
            label,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#4d4136' },
            labelStyle: { fill: '#b3a595', fontSize: 10 },
            labelBgStyle: { fill: '#151210' },
            style: { stroke: '#4d4136', strokeWidth: 1.5 }
          },
          current
        )
      )
      setDirty(true)
    },
    [nodes, edges, setEdges]
  )

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.workflows.saveGraph({
        workflowId,
        nodes: nodes.map((n) => {
          const data = n.data as NodeData
          return {
            id: n.id.startsWith('new_') ? undefined : n.id,
            kind: data.kind,
            label: data.label,
            config: data.config,
            x: n.position.x,
            y: n.position.y
          }
        }),
        edges: edges.map((e) => ({
          id: e.id.startsWith('new_') ? undefined : e.id,
          fromNodeId: e.source,
          toNodeId: e.target,
          label: (e.label as string) ?? null
        }))
      })
      await load()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const run = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNodes((current) => current.map((n) => ({ ...n, data: { ...n.data, runStatus: undefined } })))
    try {
      const result = await api.workflows.run(workflowId)
      const refreshed = await api.workflows.runs(store.activeProjectId as string, workflowId)
      setRuns(refreshed)
      setActiveRun(refreshed.find((r) => r.id === result.runId) ?? null)
      setNodeRuns(await api.workflows.nodeRuns(result.runId))
      if (result.error) setError(result.error)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectedNode = nodes.find((n) => n.id === selected) ?? null
  const blocking = issues.filter((i) => i.severity === 'error')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <h1 className="text-md font-medium">{workflow?.name ?? '…'}</h1>
        {workflow && (
          <Badge tone={workflow.trigger === 'event' ? 'magic' : 'neutral'}>
            {workflow.trigger === 'event' ? `on ${workflow.eventType}` : workflow.trigger}
          </Badge>
        )}
        {blocking.length > 0 && <Badge tone="bad">{blocking.length} problems</Badge>}
        {dirty && <Badge tone="warn">unsaved</Badge>}
        <div className="flex-1" />
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'design', label: 'Design' },
            { id: 'runs', label: `Runs ${runs.length}` }
          ]}
        />
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
          Save
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run()}
          disabled={busy || dirty || blocking.length > 0}
          title={
            dirty
              ? 'Save first'
              : blocking.length
                ? blocking.map((i) => i.message).join('\n')
                : 'Run this workflow now'
          }
        >
          {busy ? 'Running…' : 'Run'}
        </Button>
      </header>

      {error && (
        <div className="border-b border-bad/40 bg-bad/10 px-3 py-1.5 text-xs text-bad">{error}</div>
      )}

      {tab === 'design' ? (
        <div className="flex min-h-0 flex-1">
          <div className="w-36 shrink-0 border-r border-edge p-1.5">
            <div className="mb-1 px-1 text-2xs uppercase tracking-wider text-ink-faint">Palette</div>
            {(Object.keys(WORKFLOW_NODES) as WorkflowNodeKind[])
              .filter((kind) => kind !== 'start')
              .map((kind) => {
                const spec = WORKFLOW_NODES[kind]
                return (
                  <button
                    key={kind}
                    onClick={() => addNode(kind)}
                    title={spec.description}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs row-hover"
                  >
                    <span className={TONE_TEXT[spec.tone]}>{spec.glyph}</span>
                    <span className="text-ink-dim">{spec.label}</span>
                  </button>
                )
              })}
          </div>

          <div className="min-w-0 flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                onNodesChange(changes)
                if (changes.some((c) => c.type === 'position' || c.type === 'remove')) setDirty(true)
              }}
              onEdgesChange={(changes) => {
                onEdgesChange(changes)
                if (changes.some((c) => c.type === 'remove')) setDirty(true)
              }}
              onConnect={onConnect}
              onNodeClick={(_, node) => setSelected(node.id)}
              onPaneClick={() => setSelected(null)}
              fitView
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2d2620" />
              <Controls className="!bg-base-800 !border-edge" showInteractive={false} />
            </ReactFlow>
          </div>

          <div className="w-72 shrink-0 overflow-y-auto border-l border-edge p-3">
            {selectedNode ? (
              <NodeInspector
                node={selectedNode}
                onChange={(patch) => {
                  setNodes((current) =>
                    current.map((n) =>
                      n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n
                    )
                  )
                  setDirty(true)
                }}
                onDelete={() => {
                  setNodes((current) => current.filter((n) => n.id !== selectedNode.id))
                  setEdges((current) =>
                    current.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id)
                  )
                  setSelected(null)
                  setDirty(true)
                }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-ink-faint">
                  Click a node to configure it, or add one from the palette. Drag from the bottom of
                  a node to its successor to connect them.
                </p>
                {issues.length > 0 && (
                  <Panel title="Checks" dense>
                    <div className="p-2">
                      {issues.map((issue, i) => (
                        <p
                          key={i}
                          className={clsx(
                            'py-0.5 text-xs',
                            issue.severity === 'error' ? 'text-bad' : 'text-warn'
                          )}
                        >
                          {issue.message}
                        </p>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-72 shrink-0 overflow-y-auto border-r border-edge">
            {runs.length === 0 && <p className="p-3 text-xs text-ink-faint">No runs yet.</p>}
            {runs.map((runRow) => (
              <button
                key={runRow.id}
                onClick={async () => {
                  setActiveRun(runRow)
                  setNodeRuns(await api.workflows.nodeRuns(runRow.id))
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left row-hover',
                  activeRun?.id === runRow.id ? 'bg-base-750' : ''
                )}
              >
                <StatusDot status={runRow.status === 'COMPLETED' ? 'COMPLETED' : runRow.status} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{runRow.status}</div>
                  <div className="truncate text-2xs text-ink-faint">
                    {runRow.trigger} · {formatRelative(runRow.startedAt)}
                  </div>
                </div>
                <span className="mono text-2xs text-ink-faint">{runRow.steps}</span>
              </button>
            ))}
          </div>

          <div className="scroll-y min-w-0 flex-1 p-3">
            {activeRun ? (
              <>
                {activeRun.error && (
                  <div className="mb-3 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
                    {activeRun.error}
                  </div>
                )}
                <Panel title="Steps" dense>
                  <table className="w-full text-sm">
                    <tbody>
                      {nodeRuns.map((nodeRun) => (
                        <tr key={nodeRun.id} className="border-b border-edge-soft">
                          <td className="w-6 py-1.5 pl-3">
                            <StatusDot
                              status={nodeRun.status === 'COMPLETED' ? 'COMPLETED' : nodeRun.status}
                            />
                          </td>
                          <td className="py-1.5 pr-2">{nodeRun.label}</td>
                          <td className="w-20 py-1.5 text-2xs text-ink-faint">{nodeRun.kind}</td>
                          <td className="w-16 py-1.5 mono text-2xs text-ink-faint">
                            {nodeRun.endedAt
                              ? formatDuration(nodeRun.endedAt - nodeRun.startedAt)
                              : '…'}
                          </td>
                          <td className="py-1.5 pr-3 text-2xs text-ink-faint">
                            <span className="line-clamp-1">
                              {nodeRun.error ?? renderOutput(nodeRun.output)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>

                <Panel title="Final context" className="mt-3">
                  <pre className="max-h-64 scroll-y whitespace-pre-wrap mono text-2xs text-ink-dim">
                    {JSON.stringify(activeRun.context, null, 2)}
                  </pre>
                </Panel>
              </>
            ) : (
              <EmptyState title="Select a run" detail="Every run records what each node did." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function renderOutput(output: unknown): string {
  if (output == null) return ''
  if (typeof output === 'string') return output.slice(0, 120)
  return JSON.stringify(output).slice(0, 120)
}

function defaultConfig(kind: WorkflowNodeKind): Record<string, unknown> {
  switch (kind) {
    case 'delay':
      return { ms: 1000 }
    case 'condition':
      return { expression: 'vars.score > 0.8' }
    case 'loop':
      return { maxIterations: 3, expression: 'vars.iteration < 3' }
    case 'webhook':
      return { method: 'POST', url: 'https://example.com/hook', body: '{}' }
    case 'approval':
      return { action: 'Proceed?', reason: 'This step needs a human decision.' }
    case 'agent':
      return { task: 'Describe what this agent should do' }
    case 'task':
      return { title: 'New task', description: '' }
    default:
      return {}
  }
}

function NodeInspector({
  node,
  onChange,
  onDelete
}: {
  node: Node
  onChange(patch: Partial<NodeData>): void
  onDelete(): void
}): React.JSX.Element {
  const store = useStore()
  const data = node.data as NodeData
  const spec = WORKFLOW_NODES[data.kind]
  const config = data.config ?? {}

  const setConfig = (patch: Record<string, unknown>): void =>
    onChange({ config: { ...config, ...patch } })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className={TONE_TEXT[spec.tone]}>{spec.glyph}</span>
        <span className="text-sm font-medium">{spec.label}</span>
        <div className="flex-1" />
        {data.kind !== 'start' && (
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-faint">{spec.description}</p>

      <Field label="Label">
        <input value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>

      {(data.kind === 'agent' || data.kind === 'task' || data.kind === 'tool') && (
        <Field label="Agent">
          <select
            value={String(config.agent ?? '')}
            onChange={(e) => setConfig({ agent: e.target.value })}
          >
            <option value="">{data.kind === 'task' ? 'Unassigned' : 'Select an agent'}</option>
            {store.agents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {data.kind === 'agent' && (
        <Field label="Task" hint="Supports {{variable}} substitution from the run context.">
          <textarea
            rows={4}
            value={String(config.task ?? '')}
            onChange={(e) => setConfig({ task: e.target.value })}
          />
        </Field>
      )}

      {data.kind === 'task' && (
        <>
          <Field label="Title">
            <input
              value={String(config.title ?? '')}
              onChange={(e) => setConfig({ title: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={3}
              value={String(config.description ?? '')}
              onChange={(e) => setConfig({ description: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={config.wait === true}
              onChange={(e) => setConfig({ wait: e.target.checked })}
            />
            Wait for it to finish
          </label>
        </>
      )}

      {data.kind === 'tool' && (
        <>
          <Field label="Tool name">
            <input
              className="mono"
              value={String(config.tool ?? '')}
              onChange={(e) => setConfig({ tool: e.target.value })}
            />
          </Field>
          <Field label="Input (JSON)">
            <textarea
              rows={4}
              className="mono"
              value={JSON.stringify(config.input ?? {}, null, 2)}
              onChange={(e) => {
                try {
                  setConfig({ input: JSON.parse(e.target.value) })
                } catch {
                  /* keep the last valid value while the user types */
                }
              }}
            />
          </Field>
        </>
      )}

      {(data.kind === 'condition' || data.kind === 'loop') && (
        <Field
          label="Expression"
          hint="JavaScript over `vars` and `results`, e.g. vars.score > 0.8"
        >
          <textarea
            rows={2}
            className="mono"
            value={String(config.expression ?? '')}
            onChange={(e) => setConfig({ expression: e.target.value })}
          />
        </Field>
      )}

      {data.kind === 'loop' && (
        <Field label="Max iterations">
          <input
            type="number"
            value={Number(config.maxIterations ?? 3)}
            onChange={(e) => setConfig({ maxIterations: Number(e.target.value) })}
          />
        </Field>
      )}

      {data.kind === 'delay' && (
        <Field label="Milliseconds">
          <input
            type="number"
            value={Number(config.ms ?? 1000)}
            onChange={(e) => setConfig({ ms: Number(e.target.value) })}
          />
        </Field>
      )}

      {data.kind === 'approval' && (
        <>
          <Field label="Action">
            <input
              value={String(config.action ?? '')}
              onChange={(e) => setConfig({ action: e.target.value })}
            />
          </Field>
          <Field label="Reason">
            <textarea
              rows={2}
              value={String(config.reason ?? '')}
              onChange={(e) => setConfig({ reason: e.target.value })}
            />
          </Field>
        </>
      )}

      {data.kind === 'webhook' && (
        <>
          <Field label="Method">
            <select
              value={String(config.method ?? 'POST')}
              onChange={(e) => setConfig({ method: e.target.value })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="URL">
            <input
              className="mono"
              value={String(config.url ?? '')}
              onChange={(e) => setConfig({ url: e.target.value })}
            />
          </Field>
          <Field label="Body">
            <textarea
              rows={3}
              className="mono"
              value={String(config.body ?? '')}
              onChange={(e) => setConfig({ body: e.target.value })}
            />
          </Field>
        </>
      )}

      {data.kind !== 'start' && data.kind !== 'end' && (
        <Field label="Save result as" hint="Makes the result available as {{name}} downstream.">
          <input
            className="mono"
            value={String(config.saveAs ?? '')}
            onChange={(e) => setConfig({ saveAs: e.target.value })}
          />
        </Field>
      )}

      {spec.branches.length > 0 && (
        <p className="text-xs text-ink-faint">
          Connect one edge per branch: {spec.branches.join(', ')}. New connections take the next
          unused branch automatically.
        </p>
      )}
    </div>
  )
}

function NewWorkflowModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose(): void
  onCreated(workflowId: string): void
}): React.JSX.Element {
  const store = useStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [trigger, setTrigger] = useState('manual')
  const [eventType, setEventType] = useState('TASK_FAILED')

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    const workflow = await api.workflows.create({
      projectId: store.activeProjectId,
      name,
      description,
      trigger,
      eventType: trigger === 'event' ? eventType : null
    })
    setName('')
    setDescription('')
    onCreated(workflow.id)
    onClose()
  }

  return (
    <Modal open={open} title="New workflow" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly sweep" />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Trigger">
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            <option value="manual">Manual and on request from an agent</option>
            <option value="event">When an event fires</option>
          </select>
        </Field>
        {trigger === 'event' && (
          <Field label="Event type" hint="Any event the system emits, e.g. TASK_FAILED.">
            <input className="mono" value={eventType} onChange={(e) => setEventType(e.target.value)} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => void submit()}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}
