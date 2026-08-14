import React, { useCallback, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStore } from '../store'
import { AGENT_STATUS_COLOR, Badge, EmptyState, Meter, StatusDot } from '../ui'
import type { AgentGraph, AgentGraphNode } from '@shared/models'

const NODE_WIDTH = 210
const NODE_HEIGHT = 92
const H_GAP = 40
const V_GAP = 70

const EDGE_STYLE: Record<string, { stroke: string; dash?: string; label?: string }> = {
  PARENT_OF: { stroke: '#333c4d' },
  DELEGATES_TO: { stroke: '#5b8cff', dash: '6 4', label: 'delegates' },
  INVOKES: { stroke: '#a37bf0', dash: '2 3', label: 'invokes' },
  REVIEWS: { stroke: '#e0a33e', dash: '4 4', label: 'reviews' },
  REPORTS_TO: { stroke: '#232936' },
  DEPENDS_ON: { stroke: '#57b8d6', dash: '4 4' }
}

/**
 * Hierarchical layout: children are packed under their parent, and the parent
 * is centred over them. Keeps a deep recursive fleet readable without pulling
 * in a layout engine.
 */
function layout(graph: AgentGraph): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const childrenOf = new Map<string | null, AgentGraphNode[]>()
  for (const node of graph.nodes) {
    const key = node.parentAgentId && graph.nodes.some((n) => n.id === node.parentAgentId)
      ? node.parentAgentId
      : null
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), node])
  }

  let cursor = 0
  const place = (node: AgentGraphNode, depth: number): number => {
    const children = (childrenOf.get(node.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)
    if (!children.length) {
      const x = cursor * (NODE_WIDTH + H_GAP)
      cursor += 1
      positions.set(node.id, { x, y: depth * (NODE_HEIGHT + V_GAP) })
      return x
    }
    const childXs = children.map((child) => place(child, depth + 1))
    const x = (childXs[0] + childXs[childXs.length - 1]) / 2
    positions.set(node.id, { x, y: depth * (NODE_HEIGHT + V_GAP) })
    return x
  }

  for (const root of (childrenOf.get(null) ?? []).sort((a, b) => a.createdAt - b.createdAt)) {
    place(root, 0)
    cursor += 0.5
  }
  return positions
}

function AgentNode({ data, selected }: NodeProps): React.JSX.Element {
  const agent = data.agent as AgentGraphNode
  const currentTask = data.currentTask as string | undefined
  return (
    <div
      className={clsx(
        'w-[210px] rounded-lg border bg-base-850 px-2.5 py-2 shadow-lg transition-colors',
        selected ? 'border-accent' : 'border-edge',
        agent.status === 'RUNNING' && 'running-pulse'
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5">
        <StatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
        {agent.lastScore != null && (
          <span
            className={clsx(
              'mono text-2xs',
              agent.lastScore >= 0.8 ? 'text-good' : agent.lastScore >= 0.5 ? 'text-warn' : 'text-bad'
            )}
          >
            {Math.round(agent.lastScore * 100)}%
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-2xs text-ink-faint">
        {currentTask ?? (agent.description || agent.role)}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-2xs text-ink-faint">
        <span className={AGENT_STATUS_COLOR[agent.status]}>{agent.status.toLowerCase()}</span>
        <span>·</span>
        <span>d{agent.depth}</span>
        {agent.childCount > 0 && (
          <>
            <span>·</span>
            <span>{agent.childCount} children</span>
          </>
        )}
        <span className="flex-1" />
        <span>{agent.openTasks} open</span>
      </div>
      {agent.openTasks > 0 && (
        <Meter
          className="mt-1"
          value={agent.runningTasks / Math.max(1, agent.openTasks)}
          tone={agent.runningTasks ? 'good' : 'accent'}
        />
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { agent: AgentNode }

export function GraphView(): React.JSX.Element {
  const store = useStore()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const computed = useMemo(() => {
    const positions = layout(store.graph)
    const nextNodes: Node[] = store.graph.nodes.map((agent) => {
      const currentTask = store.tasks.find(
        (t) => t.agentId === agent.id && ['RUNNING', 'QUEUED'].includes(t.status)
      )?.title
      return {
        id: agent.id,
        type: 'agent',
        position: positions.get(agent.id) ?? { x: 0, y: 0 },
        data: { agent, currentTask },
        selected: agent.id === store.selectedAgentId
      }
    })

    const nextEdges: Edge[] = store.graph.edges
      .filter((edge) => edge.kind !== 'REPORTS_TO')
      .map((edge) => {
        const style = EDGE_STYLE[edge.kind] ?? EDGE_STYLE.PARENT_OF
        return {
          id: edge.id,
          source: edge.fromAgentId,
          target: edge.toAgentId,
          animated: edge.kind === 'INVOKES',
          label: style.label,
          labelStyle: { fill: '#5f6a7d', fontSize: 9 },
          labelBgStyle: { fill: '#0b0d10' },
          style: { stroke: style.stroke, strokeDasharray: style.dash, strokeWidth: 1.5 }
        }
      })

    return { nextNodes, nextEdges }
  }, [store.graph, store.tasks, store.selectedAgentId])

  useEffect(() => {
    setNodes(computed.nextNodes)
    setEdges(computed.nextEdges)
  }, [computed, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => store.selectAgent(node.id),
    [store]
  )

  if (!store.graph.nodes.length) {
    return <EmptyState title="No agents yet" detail="Launch the Orchestrator to build a fleet." />
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={(_, node) => {
          store.selectAgent(node.id)
          store.setView('agents')
        }}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1a1f2a" />
        <Controls className="!bg-base-800 !border-edge" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="!bg-base-850 !border !border-edge"
          maskColor="rgba(8,9,11,0.7)"
          nodeColor={(node) => {
            const agent = (node.data as { agent: AgentGraphNode }).agent
            return agent.status === 'RUNNING'
              ? '#3fbf7f'
              : agent.status === 'FAILED'
                ? '#e5484d'
                : '#2c3340'
          }}
        />
      </ReactFlow>

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
        <Badge>{store.graph.nodes.length} agents</Badge>
        <Badge tone="accent">delegates</Badge>
        <Badge tone="magic">invokes</Badge>
        <Badge tone="warn">reviews</Badge>
      </div>
    </div>
  )
}
