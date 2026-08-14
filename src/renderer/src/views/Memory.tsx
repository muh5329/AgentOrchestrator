import React, { useMemo, useState } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, Field, Modal, Panel, formatRelative } from '../ui'
import { MEMORY_KINDS, type MemoryKind } from '@shared/domain'

/** Project knowledge: what agents decided, learned and must not forget. */
export function MemoryView(): React.JSX.Element {
  const store = useStore()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string>('')
  const [writing, setWriting] = useState(false)

  const memories = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return store.memories.filter((memory) => {
      if (kind && memory.kind !== kind) return false
      if (!needle) return true
      return `${memory.key} ${memory.content} ${memory.tags.join(' ')}`
        .toLowerCase()
        .includes(needle)
    })
  }, [store.memories, query, kind])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory…"
          className="h-7 w-64 text-xs"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-7 text-xs">
          <option value="">All kinds</option>
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-ink-faint">{memories.length} entries</span>
        <Button size="sm" onClick={() => setWriting(true)}>
          Add memory
        </Button>
      </header>

      <div className="scroll-y min-h-0 flex-1 p-3">
        {memories.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Nothing remembered yet. Agents write here with the `remember` tool, and relevant
            entries are retrieved into later prompts instead of replaying the whole history.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {memories.map((memory) => {
              const owner = store.agents.find((a) => a.id === memory.agentId)
              return (
                <Panel
                  key={memory.id}
                  title={
                    <span className="flex items-center gap-2">
                      <Badge
                        tone={
                          memory.kind === 'constraint'
                            ? 'warn'
                            : memory.kind === 'decision'
                              ? 'accent'
                              : 'neutral'
                        }
                      >
                        {memory.kind}
                      </Badge>
                      {memory.key && <span className="mono text-2xs">{memory.key}</span>}
                    </span>
                  }
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void api.memory.remove(memory.id).then(() => store.refreshProject())
                      }
                    >
                      ✕
                    </Button>
                  }
                >
                  <p className="whitespace-pre-wrap text-sm text-ink-dim">{memory.content}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-ink-faint">
                    <span>{owner ? owner.name : 'project-wide'}</span>
                    <span>·</span>
                    <span>importance {memory.importance}</span>
                    <span>·</span>
                    <span>{formatRelative(memory.updatedAt)}</span>
                    {memory.tags.map((tag) => (
                      <span key={tag} className="rounded bg-base-750 px-1.5 py-0.5">
                        {tag}
                      </span>
                    ))}
                  </div>
                </Panel>
              )
            })}
          </div>
        )}
      </div>

      <WriteMemoryModal open={writing} onClose={() => setWriting(false)} />
    </div>
  )
}

function WriteMemoryModal({
  open,
  onClose
}: {
  open: boolean
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [content, setContent] = useState('')
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<MemoryKind>('constraint')
  const [importance, setImportance] = useState(70)

  const submit = async (): Promise<void> => {
    if (!store.activeProjectId) return
    await api.memory.write({
      projectId: store.activeProjectId,
      content,
      key: key || undefined,
      kind,
      importance,
      scope: 'project'
    })
    await store.refreshProject()
    setContent('')
    setKey('')
    onClose()
  }

  return (
    <Modal open={open} title="Add project memory" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field
          label="Content"
          hint="Write the conclusion, not the narrative. Every agent on this project will see it when it is relevant."
        >
          <textarea value={content} rows={4} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
              {MEMORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Key" hint="Optional. Later writes with the same key replace this one.">
            <input value={key} onChange={(e) => setKey(e.target.value)} className="mono" />
          </Field>
          <Field label="Importance">
            <input
              type="number"
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!content.trim()} onClick={() => void submit()}>
            Remember
          </Button>
        </div>
      </div>
    </Modal>
  )
}
