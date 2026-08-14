import vm from 'node:vm'
import type { AppContext } from '../core/context'
import type { Permission } from '../../shared/domain'
import type { ToolRow } from '../db/schema'
import { runShell } from './tools/execution'
import { findBuiltinTool } from './tools'
import { fail, ok, validateInput, type ToolInvocation, type ToolResult } from './tools/types'
import { now } from '../util/time'

export interface ToolCallRequest {
  name: string
  input: Record<string, unknown>
  invocation: ToolInvocation
}

/**
 * The single gate every tool call passes through.
 *
 * Permission checks, approval gating, timeouts, logging and usage accounting all
 * live here rather than in the individual tools, so a new tool cannot forget to
 * enforce them.
 */
export class ToolRuntime {
  constructor(private readonly ctx: AppContext) {}

  async call(request: ToolCallRequest): Promise<ToolResult> {
    const { name, input, invocation } = request
    const agent = this.ctx.agents.get(invocation.agentId)
    const startedAt = now()

    const row = this.ctx.tools.findToolForAgent(agent.id, name)
    if (!row) {
      this.ctx.bus.emit({
        type: 'TOOL_DENIED',
        projectId: invocation.projectId,
        agentId: agent.id,
        taskId: invocation.taskId,
        executionId: invocation.executionId,
        level: 'warn',
        message: `${agent.name} tried to use "${name}", which is not in its toolkits`,
        data: { tool: name }
      })
      return fail(
        `You do not have a tool called "${name}". Use only the tools listed for you, or ask ` +
          `your parent agent to grant a toolkit.`
      )
    }

    const missing = row.requiredPermissions.filter((p) => !agent.permissions.includes(p))
    if (missing.length) {
      const outcome = await this.escalate(agent.id, row, missing, invocation)
      if (!outcome.granted) {
        this.ctx.bus.emit({
          type: 'TOOL_DENIED',
          projectId: invocation.projectId,
          agentId: agent.id,
          taskId: invocation.taskId,
          executionId: invocation.executionId,
          level: 'warn',
          message: `${agent.name} denied "${name}" (missing ${missing.join(', ')})`,
          data: { tool: name, missing }
        })
        return fail(
          `Permission denied for "${name}": you lack ${missing.join(', ')}. ${outcome.reason}`
        )
      }
    }

    const settings = this.ctx.projects.settings(invocation.projectId)
    const builtin = findBuiltinTool(name)
    const needsApproval =
      (builtin?.dangerous ?? false) ||
      row.requiredPermissions.some((p) => settings.requireApprovalFor.includes(p))

    if (needsApproval && !missing.length) {
      const approval = this.ctx.approvals.request({
        projectId: invocation.projectId,
        agentId: agent.id,
        taskId: invocation.taskId,
        executionId: invocation.executionId,
        action: `${name}(${summarizeInput(input)})`,
        reason: `"${name}" requires ${row.requiredPermissions.join(', ')}, which this project gates behind human approval.`,
        payload: { tool: name, input }
      })
      const outcome = await this.ctx.approvals.wait(approval.id, 60 * 60_000, invocation.signal)
      if (outcome.status !== 'APPROVED') {
        return fail(
          `A human declined this action (${outcome.status}). Do not retry it; report blocked if you cannot continue.`
        )
      }
    }

    const validation = validateInput(row.inputSchema, input)
    if (!validation.valid) return fail(validation.error)

    this.ctx.bus.emit({
      type: 'TOOL_STARTED',
      projectId: invocation.projectId,
      agentId: agent.id,
      taskId: invocation.taskId,
      executionId: invocation.executionId,
      level: 'debug',
      message: `${agent.name} → ${name}`,
      data: { tool: name, input: redact(input) }
    })

    const timeoutMs = builtin?.timeoutMs ?? row.timeoutMs
    let result: ToolResult
    try {
      result = await withTimeout(
        builtin
          ? builtin.handler(input, invocation)
          : this.callCustom(row, input, invocation),
        timeoutMs,
        `Tool "${name}" exceeded its ${Math.round(timeoutMs / 1000)}s timeout.`
      )
    } catch (err) {
      result = fail(`Tool "${name}" threw: ${(err as Error).message}`)
    }

    this.ctx.executor.recordToolCall(invocation.executionId)

    this.ctx.bus.emit({
      type: result.ok ? 'TOOL_COMPLETED' : 'TOOL_FAILED',
      projectId: invocation.projectId,
      agentId: agent.id,
      taskId: invocation.taskId,
      executionId: invocation.executionId,
      level: result.ok ? 'debug' : 'warn',
      message: `${name} ${result.ok ? 'ok' : 'failed'} in ${now() - startedAt}ms`,
      data: { tool: name, ok: result.ok, preview: result.content.slice(0, 400) }
    })

    return result
  }

  /**
   * A tool the agent lacks permission for is not simply refused - the project
   * can allow it to ask a human, which is how least privilege stays workable.
   */
  private async escalate(
    agentId: string,
    row: ToolRow,
    missing: Permission[],
    invocation: ToolInvocation
  ): Promise<{ granted: boolean; reason: string }> {
    const agent = this.ctx.agents.get(agentId)
    const approval = this.ctx.approvals.request({
      projectId: invocation.projectId,
      agentId,
      taskId: invocation.taskId,
      executionId: invocation.executionId,
      action: `Grant ${missing.join(', ')} to "${agent.name}" for ${row.name}`,
      reason: `"${agent.name}" needs ${missing.join(', ')} to run ${row.name}.`,
      payload: { tool: row.name, missing },
      expiresInMs: 15 * 60_000
    })
    const outcome = await this.ctx.approvals.wait(approval.id, 15 * 60_000, invocation.signal)
    if (outcome.status === 'APPROVED') {
      this.ctx.agents.grant(agentId, missing)
      return { granted: true, reason: 'Granted by a human.' }
    }
    return {
      granted: false,
      reason:
        outcome.status === 'EXPIRED'
          ? 'The approval request expired with no answer.'
          : 'A human declined to grant it.'
    }
  }

  private async callCustom(
    row: ToolRow,
    input: Record<string, unknown>,
    invocation: ToolInvocation
  ): Promise<ToolResult> {
    switch (row.kind) {
      case 'shell': {
        if (!invocation.workspaceDir) return fail('This project has no workspace directory.')
        const command = interpolate(row.implementation, input)
        const result = await runShell(
          command,
          invocation.workspaceDir,
          row.timeoutMs,
          invocation.signal
        )
        const body = `exit ${result.code ?? 'killed'}\n${result.stdout}${result.stderr ? `\nstderr:\n${result.stderr}` : ''}`
        return result.code === 0 ? ok(body, result) : fail(body, result)
      }

      case 'http': {
        const spec = interpolate(row.implementation, input).trim()
        const match = spec.match(/^([A-Z]+)\s+(.*)$/)
        const method = match ? match[1] : 'GET'
        const url = match ? match[2] : spec
        if (!/^https?:\/\//i.test(url)) return fail('Tool implementation is not an http(s) URL.')
        const response = await fetch(url, {
          method,
          signal: invocation.signal,
          headers: { accept: 'application/json, text/plain, */*' },
          body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(input)
        })
        const text = await response.text()
        return response.ok
          ? ok(`HTTP ${response.status}\n${text.slice(0, 40_000)}`)
          : fail(`HTTP ${response.status}\n${text.slice(0, 4000)}`)
      }

      case 'javascript': {
        // Sandboxed: no require, no process, no filesystem. Custom JS tools are
        // for computation and shaping data, not for reaching outside.
        const sandbox: Record<string, unknown> = {
          input,
          result: undefined,
          console: { log: () => undefined, error: () => undefined },
          JSON,
          Math,
          Date
        }
        try {
          const script = new vm.Script(`result = (function(input){ ${row.implementation} })(input)`)
          const context = vm.createContext(sandbox)
          script.runInContext(context, { timeout: Math.min(row.timeoutMs, 10_000) })
          const value = sandbox.result
          return ok(typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2), value)
        } catch (err) {
          return fail(`JavaScript tool failed: ${(err as Error).message}`)
        }
      }

      case 'agent': {
        const target = this.ctx.agents.resolve(invocation.projectId, row.implementation)
        const builtin = findBuiltinTool('invoke_agent')
        if (!builtin) return fail('invoke_agent is unavailable.')
        return builtin.handler(
          { agent: target.id, task: String(input.task ?? row.description) },
          invocation
        )
      }

      default:
        return fail(`Tool kind "${row.kind}" is not executable.`)
    }
  }
}

function interpolate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const value = input[key]
    return value == null ? '' : String(value)
  })
}

function summarizeInput(input: Record<string, unknown>): string {
  const text = JSON.stringify(input)
  return text.length > 160 ? `${text.slice(0, 159)}…` : text
}

function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value
  }
  return out
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
