import { create } from 'zustand'
import { api } from './api'
import type {
  Agent,
  AgentGraph,
  AppEventRecord,
  Approval,
  Evaluation,
  Memory,
  Message,
  Project,
  ProjectStats,
  ProviderInfo,
  Schedule,
  Task
} from '@shared/models'

export type ViewId =
  | 'dashboard'
  | 'agents'
  | 'graph'
  | 'tasks'
  | 'automation'
  | 'workflows'
  | 'workspace'
  | 'memory'
  | 'settings'

interface State {
  ready: boolean
  error: string | null

  projects: Project[]
  activeProjectId: string | null

  agents: Agent[]
  tasks: Task[]
  graph: AgentGraph
  stats: ProjectStats | null
  events: AppEventRecord[]
  approvals: Approval[]
  schedules: Schedule[]
  messages: Message[]
  memories: Memory[]
  evaluations: Evaluation[]
  providers: ProviderInfo[]

  view: ViewId
  selectedAgentId: string | null
  selectedTaskId: string | null
  paletteOpen: boolean
  dockOpen: boolean
  dockTab: 'activity' | 'messages' | 'approvals'

  init(): Promise<void>
  selectProject(projectId: string | null): Promise<void>
  refreshProjects(): Promise<void>
  refreshProject(): Promise<void>
  refreshApprovals(): Promise<void>
  setView(view: ViewId): void
  selectAgent(agentId: string | null): void
  selectTask(taskId: string | null): void
  setPalette(open: boolean): void
  setDock(open: boolean, tab?: State['dockTab']): void
  pushEvent(event: AppEventRecord): void
}

const EMPTY_GRAPH: AgentGraph = { nodes: [], edges: [] }
const EVENT_BUFFER = 400

/** Which slices a given event type invalidates. */
function slicesFor(type: string): Array<'agents' | 'tasks' | 'graph' | 'stats' | 'approvals' | 'schedules' | 'messages' | 'evaluations' | 'projects'> {
  if (type.startsWith('AGENT_')) return ['agents', 'graph', 'stats']
  if (type.startsWith('TASK_')) return ['tasks', 'stats', 'graph']
  if (type.startsWith('EXECUTION_')) return ['stats', 'agents', 'tasks']
  if (type.startsWith('JUDGE_')) return ['tasks', 'stats', 'evaluations']
  if (type.startsWith('APPROVAL_')) return ['approvals']
  if (type.startsWith('SCHEDULE_')) return ['schedules', 'tasks']
  if (type === 'AGENT_MESSAGE') return ['messages']
  if (type.startsWith('PROJECT_')) return ['projects', 'stats']
  if (type.startsWith('WATCHDOG_')) return ['approvals', 'tasks']
  if (type.startsWith('BUDGET_')) return ['stats']
  return []
}

export const useStore = create<State>((set, get) => {
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = async (): Promise<void> => {
    const projectId = get().activeProjectId
    const slices = [...pending]
    pending = new Set()
    timer = null
    if (!projectId) return

    try {
      const patch: Partial<State> = {}
      await Promise.all(
        slices.map(async (slice) => {
          switch (slice) {
            case 'agents':
              patch.agents = await api.agents.list(projectId)
              break
            case 'tasks':
              patch.tasks = await api.tasks.list(projectId)
              break
            case 'graph':
              patch.graph = await api.agents.graph(projectId)
              break
            case 'stats':
              patch.stats = await api.projects.stats(projectId)
              break
            case 'approvals':
              patch.approvals = await api.approvals.pending(projectId)
              break
            case 'schedules':
              patch.schedules = await api.schedules.list(projectId)
              break
            case 'messages':
              patch.messages = await api.messages.list(projectId)
              break
            case 'evaluations':
              patch.evaluations = await api.evaluations.byProject(projectId)
              break
            case 'projects':
              patch.projects = await api.projects.list()
              break
          }
        })
      )
      set(patch)
    } catch (err) {
      set({ error: (err as Error).message })
    }
  }

  const schedule = (slices: string[]): void => {
    for (const slice of slices) pending.add(slice)
    if (timer) return
    timer = setTimeout(() => void flush(), 140)
  }

  return {
    ready: false,
    error: null,
    projects: [],
    activeProjectId: null,
    agents: [],
    tasks: [],
    graph: EMPTY_GRAPH,
    stats: null,
    events: [],
    approvals: [],
    schedules: [],
    messages: [],
    memories: [],
    evaluations: [],
    providers: [],
    view: 'dashboard',
    selectedAgentId: null,
    selectedTaskId: null,
    paletteOpen: false,
    dockOpen: true,
    dockTab: 'activity',

    async init() {
      try {
        const [projects, providers] = await Promise.all([
          api.projects.list(),
          api.providers.list()
        ])
        set({ projects, providers, ready: true })
        if (projects.length) await get().selectProject(projects[0].id)

        window.ao.onEvent((raw) => {
          const event = raw as AppEventRecord
          if (!event?.type) return
          get().pushEvent(event)
          const active = get().activeProjectId
          if (event.projectId && active && event.projectId !== active) {
            if (event.type.startsWith('PROJECT_')) schedule(['projects'])
            return
          }
          schedule(slicesFor(event.type))
        })

        // Provider availability is probed on a slower cadence.
        void api.providers.check().then((list) => set({ providers: list }))
      } catch (err) {
        set({ error: (err as Error).message, ready: true })
      }
    },

    async selectProject(projectId) {
      set({
        activeProjectId: projectId,
        selectedAgentId: null,
        selectedTaskId: null,
        agents: [],
        tasks: [],
        graph: EMPTY_GRAPH,
        stats: null
      })
      if (!projectId) return
      await get().refreshProject()
    },

    async refreshProjects() {
      set({ projects: await api.projects.list() })
    },

    async refreshProject() {
      const projectId = get().activeProjectId
      if (!projectId) return
      try {
        const [agents, tasks, graph, stats, events, approvals, schedules, messages, memories, evaluations] =
          await Promise.all([
            api.agents.list(projectId),
            api.tasks.list(projectId),
            api.agents.graph(projectId),
            api.projects.stats(projectId),
            api.events.list(projectId, EVENT_BUFFER),
            api.approvals.pending(projectId),
            api.schedules.list(projectId),
            api.messages.list(projectId),
            api.memory.list(projectId),
            api.evaluations.byProject(projectId)
          ])
        set({ agents, tasks, graph, stats, events, approvals, schedules, messages, memories, evaluations })
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    async refreshApprovals() {
      const projectId = get().activeProjectId
      if (!projectId) return
      set({ approvals: await api.approvals.pending(projectId) })
    },

    setView: (view) => set({ view }),
    selectAgent: (selectedAgentId) => set({ selectedAgentId }),
    selectTask: (selectedTaskId) => set({ selectedTaskId }),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setDock: (dockOpen, dockTab) => set(dockTab ? { dockOpen, dockTab } : { dockOpen }),

    pushEvent: (event) =>
      set((state) => ({
        events: [event, ...state.events].slice(0, EVENT_BUFFER)
      }))
  }
})

export const useActiveProject = (): Project | null => {
  const { projects, activeProjectId } = useStore()
  return projects.find((p) => p.id === activeProjectId) ?? null
}
