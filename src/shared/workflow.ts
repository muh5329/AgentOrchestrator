/**
 * Workflow vocabulary, shared between the engine and the visual builder.
 */

export const WORKFLOW_NODE_KINDS = [
  'start',
  'agent',
  'task',
  'tool',
  'condition',
  'judge',
  'delay',
  'parallel',
  'merge',
  'loop',
  'approval',
  'webhook',
  'end'
] as const
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number]

export const WORKFLOW_RUN_STATUSES = ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number]

export interface WorkflowNodeSpec {
  kind: WorkflowNodeKind
  label: string
  description: string
  /** Branch labels this node's outgoing edges may carry. */
  branches: string[]
  glyph: string
  tone: 'neutral' | 'accent' | 'good' | 'warn' | 'magic'
}

/**
 * The palette. Everything the engine can execute is described here once, so the
 * builder cannot offer a node the engine does not implement.
 */
export const WORKFLOW_NODES: Record<WorkflowNodeKind, WorkflowNodeSpec> = {
  start: {
    kind: 'start',
    label: 'Start',
    description: 'Where the run begins. Exactly one per workflow.',
    branches: [],
    glyph: '▶',
    tone: 'good'
  },
  agent: {
    kind: 'agent',
    label: 'Agent',
    description: 'Run an agent on a task and wait for its result.',
    branches: [],
    glyph: '◈',
    tone: 'accent'
  },
  task: {
    kind: 'task',
    label: 'Task',
    description: 'Create a task. Optionally queue it and carry on without waiting.',
    branches: [],
    glyph: '☰',
    tone: 'neutral'
  },
  tool: {
    kind: 'tool',
    label: 'Tool',
    description: "Call a tool using an agent's permissions.",
    branches: [],
    glyph: '⚒',
    tone: 'neutral'
  },
  condition: {
    kind: 'condition',
    label: 'Condition',
    description: 'Branch on an expression evaluated against the run context.',
    branches: ['true', 'false'],
    glyph: '◆',
    tone: 'warn'
  },
  judge: {
    kind: 'judge',
    label: 'Judge',
    description: 'Evaluate a task and put the verdict into the context.',
    branches: [],
    glyph: '⚖',
    tone: 'magic'
  },
  delay: {
    kind: 'delay',
    label: 'Delay',
    description: 'Wait before continuing.',
    branches: [],
    glyph: '⏱',
    tone: 'neutral'
  },
  parallel: {
    kind: 'parallel',
    label: 'Parallel',
    description: 'Run every outgoing branch at once; continue at the merge node.',
    branches: [],
    glyph: '⑂',
    tone: 'accent'
  },
  merge: {
    kind: 'merge',
    label: 'Merge',
    description: 'Where parallel branches rejoin.',
    branches: [],
    glyph: '⑃',
    tone: 'accent'
  },
  loop: {
    kind: 'loop',
    label: 'Loop',
    description: 'Repeat the body while a condition holds, up to a maximum.',
    branches: ['body', 'done'],
    glyph: '↻',
    tone: 'warn'
  },
  approval: {
    kind: 'approval',
    label: 'Human approval',
    description: 'Pause until a person approves or denies.',
    branches: ['approved', 'denied'],
    glyph: '✋',
    tone: 'warn'
  },
  webhook: {
    kind: 'webhook',
    label: 'Webhook',
    description: 'Call an HTTP endpoint and capture the response.',
    branches: [],
    glyph: '⇗',
    tone: 'neutral'
  },
  end: {
    kind: 'end',
    label: 'End',
    description: 'Finish the run.',
    branches: [],
    glyph: '■',
    tone: 'neutral'
  }
}

export interface WorkflowNodeConfig {
  /* agent / task */
  agent?: string
  task?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  judge?: boolean
  wait?: boolean
  priority?: number
  /* tool */
  tool?: string
  input?: Record<string, unknown>
  /* condition / loop */
  expression?: string
  maxIterations?: number
  /* judge */
  taskId?: string
  /* delay */
  ms?: number
  /* approval */
  action?: string
  reason?: string
  /* webhook */
  method?: string
  url?: string
  body?: string
  /* every node */
  saveAs?: string
  [key: string]: unknown
}

export interface WorkflowValidationIssue {
  nodeId: string | null
  message: string
  severity: 'error' | 'warning'
}

export interface WorkflowGraphInput {
  nodes: Array<{ id: string; kind: WorkflowNodeKind; label: string; config: WorkflowNodeConfig }>
  edges: Array<{ id: string; fromNodeId: string; toNodeId: string; label?: string | null }>
}

/**
 * Static checks the builder runs before saving and the engine runs before
 * executing, so a broken graph fails with an explanation rather than midway.
 */
export function validateWorkflow(graph: WorkflowGraphInput): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const starts = graph.nodes.filter((n) => n.kind === 'start')

  if (starts.length === 0) {
    issues.push({ nodeId: null, message: 'The workflow has no Start node.', severity: 'error' })
  }
  if (starts.length > 1) {
    issues.push({
      nodeId: null,
      message: `There are ${starts.length} Start nodes; there must be exactly one.`,
      severity: 'error'
    })
  }

  const out = new Map<string, Array<{ toNodeId: string; label?: string | null }>>()
  for (const edge of graph.edges) {
    out.set(edge.fromNodeId, [...(out.get(edge.fromNodeId) ?? []), edge])
  }
  const incoming = new Set(graph.edges.map((e) => e.toNodeId))

  for (const node of graph.nodes) {
    const spec = WORKFLOW_NODES[node.kind]
    const outgoing = out.get(node.id) ?? []

    if (node.kind !== 'start' && !incoming.has(node.id)) {
      issues.push({
        nodeId: node.id,
        message: `"${node.label}" is unreachable - nothing connects to it.`,
        severity: 'warning'
      })
    }
    if (node.kind !== 'end' && outgoing.length === 0) {
      issues.push({
        nodeId: node.id,
        message: `"${node.label}" has no outgoing connection, so the run stops there.`,
        severity: 'warning'
      })
    }

    for (const branch of spec.branches) {
      if (!outgoing.some((e) => e.label === branch)) {
        issues.push({
          nodeId: node.id,
          message: `"${node.label}" has no "${branch}" branch connected.`,
          severity: branch === 'done' || branch === 'false' || branch === 'denied' ? 'warning' : 'error'
        })
      }
    }

    if (node.kind === 'condition' && !node.config.expression) {
      issues.push({ nodeId: node.id, message: 'The condition has no expression.', severity: 'error' })
    }
    if (node.kind === 'agent' && !node.config.agent) {
      issues.push({ nodeId: node.id, message: 'The agent node has no agent selected.', severity: 'error' })
    }
    if (node.kind === 'tool' && !node.config.tool) {
      issues.push({ nodeId: node.id, message: 'The tool node has no tool selected.', severity: 'error' })
    }
    if (node.kind === 'webhook' && !node.config.url) {
      issues.push({ nodeId: node.id, message: 'The webhook node has no URL.', severity: 'error' })
    }
    if (node.kind === 'parallel' && outgoing.length < 2) {
      issues.push({
        nodeId: node.id,
        message: 'A Parallel node with fewer than two branches does nothing useful.',
        severity: 'warning'
      })
    }
  }

  return issues
}
