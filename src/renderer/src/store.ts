import { create } from 'zustand'
import { api } from './api'
import type {
  Agent,
  AgentGraph,
  AppEventRecord,
  Approval,
  Evaluation,
  FleetOverview,
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
  | 'floor'
  | 'agents'
  | 'graph'
  | 'tasks'
  | 'automation'
  | 'workflows'
  | 'workspace'
  | 'memory'
  | 'settings'

/**
 * The centre column is a document area, so what it shows is a list of open tabs
 * rather than a single current view. A tab's id is derived from what it points
 * at, which is what makes opening the same thing twice a no-op.
 */
export type DocTabSpec =
  | { kind: 'report'; projectId: string; title: string }
  | { kind: 'agent'; projectId: string; agentId: string; title: string }
  | { kind: 'view'; projectId: string; view: ViewId; title: string }

export type DocTab = DocTabSpec & { id: string }

export function tabId(tab: DocTabSpec): string {
  if (tab.kind === 'agent') return `agent:${tab.agentId}`
  if (tab.kind === 'view') return `view:${tab.projectId}:${tab.view}`
  return `report:${tab.projectId}`
}

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

  /** Every agent in every project - the sessions rail is not project-scoped. */
  fleet: FleetOverview

  view: ViewId
  tabs: DocTab[]
  activeTabId: string | null
  terminalOpen: boolean
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
  refreshFleet(): Promise<void>
  setView(view: ViewId): void
  openTab(tab: DocTabSpec): void
  closeTab(id: string): void
  activateTab(id: string): void
  setTerminal(open: boolean): void
  selectAgent(agentId: string | null): void
  selectTask(taskId: string | null): void
  setPalette(open: boolean): void
  setDock(open: boolean, tab?: State['dockTab']): void
  pushEvent(event: AppEventRecord): void
}

const EMPTY_GRAPH: AgentGraph = { nodes: [], edges: [] }
const EVENT_BUFFER = 400

/** Which slices a given event type invalidates. */
type Slice =
  | 'agents'
  | 'tasks'
  | 'graph'
  | 'stats'
  | 'approvals'
  | 'schedules'
  | 'messages'
  | 'evaluations'
  | 'projects'
  | 'fleet'

function slicesFor(type: string): Slice[] {
  // Exact matches first. `AGENT_MESSAGE` is not an agent-lifecycle event, and
  // being caught by the `AGENT_` prefix below meant a message never refreshed
  // the thread - it only appeared after something else happened to reload it.
  if (type === 'AGENT_MESSAGE') return ['messages']
  if (type.startsWith('AGENT_')) return ['agents', 'graph', 'stats', 'fleet']
  if (type.startsWith('TASK_')) return ['tasks', 'stats', 'graph', 'fleet']
  if (type.startsWith('EXECUTION_')) return ['stats', 'agents', 'tasks', 'fleet']
  if (type.startsWith('JUDGE_')) return ['tasks', 'stats', 'evaluations', 'fleet']
  if (type.startsWith('APPROVAL_')) return ['approvals']
  if (type.startsWith('SCHEDULE_')) return ['schedules', 'tasks']
  if (type.startsWith('PROJECT_')) return ['projects', 'stats', 'fleet']
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

    // `fleet` and `projects` span every project, so they still refresh when
    // nothing is selected - the sessions rail has to stay live regardless.
    if (!projectId && !slices.includes('fleet') && !slices.includes('projects')) return

    try {
      const patch: Partial<State> = {}
      await Promise.all(
        slices.map(async (slice) => {
          if (slice !== 'fleet' && slice !== 'projects' && !projectId) return
          // Narrowed for the project-scoped branches below.
          const pid = projectId as string
          switch (slice) {
            case 'fleet':
              patch.fleet = await api.fleet.overview()
              break
            case 'agents':
              patch.agents = await api.agents.list(pid)
              break
            case 'tasks':
              patch.tasks = await api.tasks.list(pid)
              break
            case 'graph':
              patch.graph = await api.agents.graph(pid)
              break
            case 'stats':
              patch.stats = await api.projects.stats(pid)
              break
            case 'approvals':
              patch.approvals = await api.approvals.pending(pid)
              break
            case 'schedules':
              patch.schedules = await api.schedules.list(pid)
              break
            case 'messages':
              patch.messages = await api.messages.list(pid)
              break
            case 'evaluations':
              patch.evaluations = await api.evaluations.byProject(pid)
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
    fleet: { projects: [], agents: [] },
    view: 'dashboard',
    tabs: [],
    activeTabId: null,
    terminalOpen: true,
    selectedAgentId: null,
    selectedTaskId: null,
    paletteOpen: false,
    dockOpen: false,
    dockTab: 'activity',

    async init() {
      try {
        const [projects, providers, fleet] = await Promise.all([
          api.projects.list(),
          api.providers.list(),
          api.fleet.overview()
        ])
        set({ projects, providers, fleet, ready: true })
        if (projects.length) await get().selectProject(projects[0].id)

        window.ao.onEvent((raw) => {
          const event = raw as AppEventRecord
          if (!event?.type) return
          get().pushEvent(event)
          const active = get().activeProjectId
          const slices = slicesFor(event.type)
          if (event.projectId && active && event.projectId !== active) {
            // Another project's event: the project-scoped slices are not ours to
            // refresh, but the sessions rail spans the whole fleet and would go
            // stale if we dropped these entirely.
            schedule(slices.filter((s) => s === 'fleet' || s === 'projects'))
            return
          }
          schedule(slices)
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

      // Every project opens on its report, and tabs from other projects are not
      // carried over - a tab pointing at a project you are no longer in would
      // render against state the store has already dropped.
      const report: DocTab = {
        id: tabId({ kind: 'report', projectId, title: '' }),
        kind: 'report',
        projectId,
        title: 'Report'
      }
      set((state) => {
        const kept = state.tabs.filter((t) => t.projectId === projectId)
        const tabs = kept.some((t) => t.id === report.id) ? kept : [report, ...kept]
        return {
          tabs,
          activeTabId: kept.some((t) => t.id === state.activeTabId) ? state.activeTabId : report.id
        }
      })

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

    async refreshFleet() {
      try {
        set({ fleet: await api.fleet.overview() })
      } catch (err) {
        set({ error: (err as Error).message })
      }
    },

    setView: (view) => set({ view }),

    openTab: (tab) => {
      const id = tabId(tab)
      set((state) => ({
        tabs: state.tabs.some((t) => t.id === id)
          ? state.tabs
          : [...state.tabs, { ...tab, id } as DocTab],
        activeTabId: id
      }))
    },

    closeTab: (id) =>
      set((state) => {
        const index = state.tabs.findIndex((t) => t.id === id)
        if (index === -1) return {}
        const tabs = state.tabs.filter((t) => t.id !== id)
        if (state.activeTabId !== id) return { tabs }
        // Fall back to the neighbour on the left, the way editors do.
        const next = tabs[Math.max(0, index - 1)] ?? null
        return { tabs, activeTabId: next?.id ?? null }
      }),

    activateTab: (activeTabId) => set({ activeTabId }),
    setTerminal: (terminalOpen) => set({ terminalOpen }),

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
