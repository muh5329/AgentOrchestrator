import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Button, StatusDot } from '../ui'
import { RobotAvatar } from './RobotAvatar'

/**
 * A command runner docked under the document pane.
 *
 * It runs in the project's shared checkout by default, or inside a chosen
 * agent's worktree, which is the difference that matters when several agents are
 * editing the same repository on their own branches.
 *
 * Honest about what it is not: there is no PTY here, so interactive programs
 * will not behave as they do in your shell. A real terminal means another native
 * module, and this project has paid enough for those.
 */
export function Terminal({ projectId }: { projectId: string }): React.JSX.Element {
  const store = useStore()
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [lines, setLines] = useState<Array<{ text: string; stream: string }>>([])
  const [session, setSession] = useState<{ id: string; running: boolean } | null>(null)
  const [cwdAgentId, setCwdAgentId] = useState<string | null>(null)
  const [root, setRoot] = useState<string>('')
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return window.ao.onEvent((raw) => {
      const event = raw as { type?: string; message?: string; data?: Record<string, unknown> }
      if (event.type === 'CONSOLE_OUTPUT') {
        setLines((current) =>
          [
            ...current,
            { text: String(event.message ?? ''), stream: String(event.data?.stream ?? 'stdout') }
          ].slice(-800)
        )
      }
      if (event.type === 'CONSOLE_EXIT') {
        const code = Number(event.data?.exitCode ?? 0)
        setLines((current) => [
          ...current,
          { text: `[exit ${code}]`, stream: code === 0 ? 'meta' : 'stderr' }
        ])
        setSession((s) => (s ? { ...s, running: false } : null))
      }
    })
  }, [])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines])

  useEffect(() => {
    let cancelled = false
    api.files
      .root(projectId, cwdAgentId)
      .then((r) => {
        if (!cancelled) setRoot(r.root)
      })
      .catch(() => {
        if (!cancelled) setRoot('')
      })
    return () => {
      cancelled = true
    }
  }, [projectId, cwdAgentId])

  const run = async (): Promise<void> => {
    const text = command.trim()
    if (!text) return
    setLines((current) => [...current, { text: `$ ${text}`, stream: 'prompt' }])
    setHistory((h) => [text, ...h.filter((c) => c !== text)].slice(0, 100))
    setHistoryIndex(-1)
    setCommand('')
    try {
      const started = await api.console.run(projectId, text, cwdAgentId)
      setSession({ id: started.id, running: true })
    } catch (err) {
      setLines((current) => [...current, { text: (err as Error).message, stream: 'stderr' }])
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      void run()
      return
    }
    // Shell-style history: up walks back, down walks forward to the empty line.
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const next = Math.min(historyIndex + 1, history.length - 1)
      setHistoryIndex(next)
      setCommand(history[next])
    }
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      setCommand(next < 0 ? '' : history[next])
    }
  }

  const worktreeAgents = store.agents.filter((a) => a.role !== 'judge')
  const cwdAgent = store.agents.find((a) => a.id === cwdAgentId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-900" onClick={() => inputRef.current?.focus()}>
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-edge bg-base-850 px-2">
        <span className="text-2xs uppercase tracking-wider text-ink-faint">Terminal</span>

        <select
          className="h-5 border-0 bg-transparent py-0 text-2xs text-ink-dim"
          value={cwdAgentId ?? ''}
          onChange={(e) => setCwdAgentId(e.target.value || null)}
          onClick={(e) => e.stopPropagation()}
          title="Run in the shared checkout, or inside one agent's worktree"
        >
          <option value="">shared workspace</option>
          {worktreeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}&apos;s worktree
            </option>
          ))}
        </select>

        {cwdAgent && <RobotAvatar seed={cwdAgent.id} size={14} />}
        {root && (
          <span className="truncate font-mono text-2xs text-ink-faint" title={root}>
            {root}
          </span>
        )}

        <div className="flex-1" />
        {session?.running && (
          <>
            <StatusDot status="RUNNING" />
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                void api.console.kill(session.id)
              }}
            >
              Stop
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            setLines([])
          }}
        >
          Clear
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation()
            store.setTerminal(false)
          }}
          title="Hide the terminal"
        >
          ▾
        </Button>
      </div>

      <div ref={outputRef} className="scroll-y min-h-0 flex-1 px-3 py-1.5">
        {lines.length === 0 && (
          <p className="font-mono text-2xs leading-relaxed text-ink-faint">
            Runs commands in the selected workspace. Not a full terminal — there is no TTY, so
            interactive programs will not behave as they do in your shell.
          </p>
        )}
        {lines.map((line, i) => (
          <pre
            key={i}
            className={clsx(
              'whitespace-pre-wrap font-mono text-2xs leading-relaxed',
              line.stream === 'stderr' && 'text-warn',
              line.stream === 'prompt' && 'text-accent',
              line.stream === 'meta' && 'text-good',
              line.stream === 'stdout' && 'text-ink-dim'
            )}
          >
            {line.text}
          </pre>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-edge px-2 py-1">
        <span className="font-mono text-xs text-accent">$</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="npm test"
          spellCheck={false}
          className="h-6 flex-1 border-0 bg-transparent px-0 font-mono text-xs"
        />
        <Button size="sm" onClick={() => void run()} disabled={!command.trim()}>
          Run
        </Button>
      </div>
    </div>
  )
}
