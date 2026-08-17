import { gitTools, workflowTools } from './automation'
import { executionTools, webTools } from './execution'
import { filesystemTools } from './filesystem'
import { knowledgeTools } from './knowledge'
import { lifecycleTools } from './lifecycle'
import { orchestrationTools } from './orchestration'
import { releaseTools } from './release'
import type { ToolDefinition } from './types'

export const BUILTIN_TOOLS: ToolDefinition[] = [
  ...lifecycleTools,
  ...orchestrationTools,
  ...knowledgeTools,
  ...filesystemTools,
  ...executionTools,
  ...webTools,
  ...workflowTools,
  ...gitTools,
  ...releaseTools
]

const byName = new Map(BUILTIN_TOOLS.map((t) => [t.name, t]))

export function findBuiltinTool(name: string): ToolDefinition | undefined {
  return byName.get(name)
}

export interface ToolkitDefinition {
  name: string
  description: string
  tools: string[]
}

/**
 * Named bundles of capability. A toolkit is how a human or an orchestrator says
 * "this agent may touch the filesystem" without enumerating tools by hand.
 *
 * `Core` is implicit - every agent gets it - because an agent with no way to
 * finish or report a blocker is a hung process waiting to happen.
 */
export const BUILTIN_TOOLKITS: ToolkitDefinition[] = [
  {
    name: 'Core',
    description: 'Lifecycle tools every agent has: finishing, reporting blockers, asking a human.',
    tools: ['complete_task', 'report_blocked', 'request_approval', 'remember', 'recall']
  },
  {
    name: 'Orchestration',
    description: 'Create and command other agents, tasks and schedules.',
    tools: orchestrationTools.map((t) => t.name)
  },
  {
    name: 'Release',
    description:
      'Ship it: branches, commits, pull requests, versions, release notes, licences, the dev ' +
      'server, the editor, the message board and email.',
    tools: releaseTools.map((t) => t.name)
  },
  {
    name: 'Knowledge',
    description: 'Memory, messaging and artifacts.',
    tools: knowledgeTools.map((t) => t.name)
  },
  {
    name: 'Inspection',
    description: 'Read-only view of the workspace and the project, plus judgement.',
    tools: ['read_file', 'list_dir', 'search_files', 'list_tasks', 'project_status', 'request_judgement']
  },
  {
    name: 'Filesystem',
    description: 'Read and write files in the project workspace.',
    tools: filesystemTools.map((t) => t.name)
  },
  {
    name: 'Execution',
    description: 'Run shell commands and test suites.',
    tools: executionTools.map((t) => t.name)
  },
  {
    name: 'Web',
    description: 'Fetch pages from the internet.',
    tools: webTools.map((t) => t.name)
  },
  {
    name: 'Automation',
    description: 'Run saved workflows.',
    tools: workflowTools.map((t) => t.name)
  },
  {
    name: 'Git',
    description: 'Inspect and commit work, and merge between agent worktrees.',
    tools: gitTools.map((t) => t.name)
  },
  {
    name: 'Judging',
    description: 'Evaluate work against acceptance criteria.',
    tools: ['request_judgement', 'read_file', 'list_dir', 'search_files']
  }
]

/** Tools every agent gets without any toolkit assignment. */
export const CORE_TOOL_NAMES = BUILTIN_TOOLKITS.find((k) => k.name === 'Core')!.tools

export type { ToolDefinition }
