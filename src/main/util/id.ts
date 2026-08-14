import { randomUUID, randomBytes } from 'node:crypto'

/** Prefixed, sortable-enough identifiers that read well in logs and the UI. */
export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`
}

export function token(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function shortId(): string {
  return randomUUID().slice(0, 8)
}
