export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, identifier: string) {
    super(`${what} not found: ${identifier}`, 'NOT_FOUND', { what, identifier })
    this.name = 'NotFoundError'
  }
}

export class PermissionError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'PERMISSION_DENIED', details)
    this.name = 'PermissionError'
  }
}

export class LimitError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, 'LIMIT_EXCEEDED', details)
    this.name = 'LimitError'
  }
}

export class ApprovalRequiredError extends AppError {
  constructor(
    message: string,
    readonly approvalId: string,
    details: Record<string, unknown> = {}
  ) {
    super(message, 'APPROVAL_REQUIRED', { ...details, approvalId })
    this.name = 'ApprovalRequiredError'
  }
}

export function serializeError(err: unknown): { message: string; code: string; details?: unknown } {
  if (err instanceof AppError) {
    return { message: err.message, code: err.code, details: err.details }
  }
  if (err instanceof Error) return { message: err.message, code: 'ERROR' }
  return { message: String(err), code: 'ERROR' }
}
