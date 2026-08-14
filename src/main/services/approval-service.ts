import { and, desc, eq } from 'drizzle-orm'
import type { AppContext } from '../core/context'
import { approvals as approvalsTable, type ApprovalRow } from '../db/schema'
import type { ApprovalStatus } from '../../shared/domain'
import { NotFoundError } from '../core/errors'
import { id } from '../util/id'
import { now } from '../util/time'

export interface RequestApprovalInput {
  projectId: string
  agentId?: string | null
  taskId?: string | null
  executionId?: string | null
  action: string
  reason: string
  payload?: Record<string, unknown>
  expiresInMs?: number
}

export interface ApprovalOutcome {
  status: ApprovalStatus
  resolution: string | null
}

/**
 * The boundary where the system stops being autonomous.
 *
 * Anything irreversible, expensive or explicitly gated routes through here and
 * blocks until a human decides - or until the request expires.
 */
export class ApprovalService {
  private readonly waiters = new Map<string, Array<(outcome: ApprovalOutcome) => void>>()

  constructor(private readonly ctx: AppContext) {}

  request(input: RequestApprovalInput): ApprovalRow {
    const approvalId = id('apr')
    this.ctx.db
      .insert(approvalsTable)
      .values({
        id: approvalId,
        projectId: input.projectId,
        agentId: input.agentId ?? null,
        taskId: input.taskId ?? null,
        executionId: input.executionId ?? null,
        action: input.action,
        reason: input.reason,
        payload: input.payload ?? {},
        status: 'PENDING',
        expiresAt: input.expiresInMs ? now() + input.expiresInMs : null,
        createdAt: now()
      })
      .run()

    const agentName = input.agentId
      ? (this.ctx.agents.find(input.agentId)?.name ?? 'An agent')
      : 'The system'

    this.ctx.bus.emit({
      type: 'APPROVAL_REQUESTED',
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      executionId: input.executionId ?? null,
      level: 'warn',
      message: `${agentName} needs approval: ${input.action}`,
      data: { approvalId, action: input.action, reason: input.reason }
    })

    return this.get(approvalId)
  }

  get(approvalId: string): ApprovalRow {
    const row = this.ctx.db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.id, approvalId))
      .get()
    if (!row) throw new NotFoundError('Approval', approvalId)
    return row
  }

  pending(projectId?: string): ApprovalRow[] {
    return this.ctx.db
      .select()
      .from(approvalsTable)
      .where(
        projectId
          ? and(eq(approvalsTable.status, 'PENDING'), eq(approvalsTable.projectId, projectId))
          : eq(approvalsTable.status, 'PENDING')
      )
      .orderBy(desc(approvalsTable.createdAt))
      .all()
  }

  list(projectId: string, limit = 100): ApprovalRow[] {
    return this.ctx.db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.projectId, projectId))
      .orderBy(desc(approvalsTable.createdAt))
      .limit(limit)
      .all()
  }

  resolve(approvalId: string, approved: boolean, resolution = ''): ApprovalRow {
    const before = this.get(approvalId)
    if (before.status !== 'PENDING') return before

    const status: ApprovalStatus = approved ? 'APPROVED' : 'DENIED'
    this.ctx.db
      .update(approvalsTable)
      .set({ status, resolution, decidedAt: now() })
      .where(eq(approvalsTable.id, approvalId))
      .run()

    this.ctx.bus.emit({
      type: 'APPROVAL_RESOLVED',
      projectId: before.projectId,
      agentId: before.agentId,
      taskId: before.taskId,
      executionId: before.executionId,
      message: `Approval ${approved ? 'granted' : 'denied'}: ${before.action}`,
      data: { approvalId, status, resolution }
    })

    this.flush(approvalId, { status, resolution })
    return this.get(approvalId)
  }

  private flush(approvalId: string, outcome: ApprovalOutcome): void {
    const list = this.waiters.get(approvalId)
    if (!list) return
    this.waiters.delete(approvalId)
    for (const resolve of list) resolve(outcome)
  }

  /** Blocks the calling execution until a human answers, or the wait expires. */
  wait(approvalId: string, timeoutMs = 30 * 60_000, signal?: AbortSignal): Promise<ApprovalOutcome> {
    const current = this.get(approvalId)
    if (current.status !== 'PENDING') {
      return Promise.resolve({ status: current.status, resolution: current.resolution })
    }

    return new Promise((resolve) => {
      const settle = (outcome: ApprovalOutcome): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const list = this.waiters.get(approvalId) ?? []
      list.push(settle)
      this.waiters.set(approvalId, list)

      const onAbort = (): void => {
        this.flush(approvalId, { status: 'DENIED', resolution: 'Execution cancelled' })
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const timer = setTimeout(() => {
        this.ctx.db
          .update(approvalsTable)
          .set({ status: 'EXPIRED', decidedAt: now() })
          .where(eq(approvalsTable.id, approvalId))
          .run()
        this.flush(approvalId, { status: 'EXPIRED', resolution: 'Timed out' })
      }, timeoutMs)
    })
  }

  expireStale(): number {
    const rows = this.pending()
    let n = 0
    for (const row of rows) {
      if (row.expiresAt && row.expiresAt < now()) {
        this.ctx.db
          .update(approvalsTable)
          .set({ status: 'EXPIRED', decidedAt: now() })
          .where(eq(approvalsTable.id, row.id))
          .run()
        this.flush(row.id, { status: 'EXPIRED', resolution: 'Expired' })
        n++
      }
    }
    return n
  }
}
