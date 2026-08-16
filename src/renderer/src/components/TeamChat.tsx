import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Button, formatRelative } from '../ui'
import { RobotAvatar } from './RobotAvatar'

/**
 * The fleet talking to itself, and a way in.
 *
 * Agents already message each other through `send_message` and `broadcast`; this
 * is that same thread rendered, with a composer that posts as the human. A
 * message addressed to one agent lands in its inbox and it reads it on its next
 * turn - so this is a way to steer a running fleet without stopping it.
 */
export function TeamChat(): React.JSX.Element {
  const store = useStore()
  const [draft, setDraft] = useState('')
  const [to, setTo] = useState<string>('')
  const [open, setOpen] = useState(true)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const messages = [...store.messages].sort((a, b) => a.createdAt - b.createdAt).slice(-60)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length, open])

  const name = (agentId: string | null): string =>
    agentId ? (store.agents.find((a) => a.id === agentId)?.name ?? 'unknown') : 'You'

  const send = async (): Promise<void> => {
    const content = draft.trim()
    if (!content || !store.activeProjectId) return
    setSending(true)
    try {
      await api.messages.send({
        projectId: store.activeProjectId,
        fromAgentId: null,
        toAgentId: to || null,
        content,
        type: to ? 'MESSAGE' : 'BROADCAST'
      })
      setDraft('')
    } catch (err) {
      useStore.setState({ error: (err as Error).message })
    } finally {
      setSending(false)
    }
  }

  const online = store.agents.filter((a) => a.status === 'RUNNING').length

  return (
    <div data-pane="chat" className="flex min-h-0 flex-col border-t border-edge bg-base-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-ink-dim">Team chat</span>
        <span
          className={clsx('h-1.5 w-1.5 rounded-full', online ? 'bg-good' : 'bg-ink-faint')}
          title={`${online} running`}
        />
        <span className="flex-1" />
        <span className="text-2xs text-ink-faint">
          {online ? `${online} running` : `${store.messages.length}`}
        </span>
        <span className="text-2xs text-ink-faint">{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <>
          <div ref={listRef} className="scroll-y max-h-52 min-h-0 flex-1 px-2 pb-2">
            {!store.activeProjectId ? (
              <p className="px-1 py-2 text-2xs text-ink-faint">Select a project to see its traffic.</p>
            ) : messages.length === 0 ? (
              <p className="px-1 py-2 text-2xs text-ink-faint">
                Nothing said yet. Agents post here when they delegate, report or ask for help.
              </p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="mb-2 flex gap-1.5">
                  {message.fromAgentId ? (
                    <RobotAvatar seed={message.fromAgentId} size={18} className="mt-0.5" />
                  ) : (
                    <span className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-soft text-2xs text-accent">
                      ⌂
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-2xs font-medium text-ink-dim">
                        {name(message.fromAgentId)}
                      </span>
                      {message.toAgentId && (
                        <span className="truncate text-2xs text-ink-faint">
                          → {name(message.toAgentId)}
                        </span>
                      )}
                      {message.type !== 'MESSAGE' && (
                        <span className="shrink-0 text-2xs uppercase text-ink-faint opacity-70">
                          {message.type.toLowerCase()}
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="shrink-0 text-2xs text-ink-faint">
                        {formatRelative(message.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-2xs leading-relaxed text-ink-dim">
                      {message.content}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {store.activeProjectId && (
            <div className="shrink-0 border-t border-edge p-2">
              <select
                className="mb-1 h-6 w-full py-0 text-2xs"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="">Everyone (broadcast)</option>
                {store.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-1">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder="Message the fleet…"
                  className="h-6 flex-1 text-2xs"
                />
                <Button size="sm" onClick={() => void send()} disabled={!draft.trim() || sending}>
                  ↑
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
