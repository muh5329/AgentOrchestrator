import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { api } from '../api'
import { useStore } from '../store'
import { Button, Field, Modal, Tabs } from '../ui'
import { RobotAvatar } from './RobotAvatar'
import type { AgentTemplate } from '@shared/agent-templates'
import { PERMISSIONS, type Permission } from '@shared/domain'

/**
 * Hiring.
 *
 * Three ways in, all of which end at the same `agents.create`: pick a role from
 * the catalogue, paste a blueprint someone exported, or write one from scratch.
 * They are tabs rather than three buttons because the choice is "where does this
 * agent's design come from", and that is one decision.
 */
export function NewAgentModal({
  open,
  projectId,
  onClose
}: {
  open: boolean
  projectId: string
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'template' | 'blueprint' | 'blank'>('template')
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Template tab
  const [selected, setSelected] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')

  // Blueprint tab
  const [json, setJson] = useState('')

  // Blank tab
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [permissions, setPermissions] = useState<Permission[]>(['FILES_READ', 'MEMORY_WRITE'])
  const [toolkits, setToolkits] = useState<string[]>(['Filesystem', 'Knowledge'])

  useEffect(() => {
    if (!open) return
    setError(null)
    api.blueprints
      .templates()
      .then(setTemplates)
      .catch((err) => setError((err as Error).message))
  }, [open])

  const taken = useMemo(() => new Set(store.agents.map((a) => a.role)), [store.agents])
  const template = templates.find((t) => t.id === selected) ?? null

  const finish = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await run()
      await store.refreshProject()
      await store.refreshFleet()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const availableToolkits = ['Orchestration', 'Filesystem', 'Execution', 'Git', 'Knowledge', 'Web', 'Judging', 'Inspection', 'Automation']

  return (
    <Modal open={open} title="New agent" onClose={onClose} width="max-w-3xl">
      <Tabs
        tabs={[
          { id: 'template', label: 'From a role' },
          { id: 'blueprint', label: 'From a blueprint' },
          { id: 'blank', label: 'From scratch' }
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4">
        {tab === 'template' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {templates.map((item) => {
                const unavailable = item.singleton && taken.has(item.role)
                return (
                  <button
                    key={item.id}
                    disabled={unavailable}
                    onClick={() => {
                      setSelected(item.id)
                      setTemplateName(item.name)
                    }}
                    className={clsx(
                      'rounded-lg border px-3 py-2 text-left transition-colors',
                      unavailable
                        ? 'cursor-not-allowed border-edge-soft bg-base-800/40 opacity-45'
                        : selected === item.id
                          ? 'border-accent/60 bg-accent-soft/40'
                          : 'border-edge bg-base-800 hover:border-edge-bright'
                    )}
                    title={
                      unavailable
                        ? `This project already has a ${item.name}. Only one may exist.`
                        : item.summary
                    }
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-accent">{item.glyph}</span>
                      <span className="text-sm text-ink">{item.name}</span>
                      {item.singleton && (
                        <span className="rounded bg-base-750 px-1 text-2xs uppercase text-ink-faint">
                          one only
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-2xs leading-snug text-ink-faint">
                      {item.summary}
                    </span>
                  </button>
                )
              })}
            </div>

            {template && (
              <div className="mt-3 space-y-3 rounded-lg border border-edge bg-base-800 p-3">
                <Field label="Name">
                  <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                </Field>
                <div>
                  <span className="mb-1 block text-2xs uppercase tracking-wider text-ink-faint">
                    It will be told
                  </span>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-edge bg-base-850 p-2 font-mono text-2xs leading-relaxed text-ink-dim">
                    {template.systemPrompt}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-1">
                  {template.toolkits.map((kit) => (
                    <span key={kit} className="rounded bg-base-750 px-1.5 py-0.5 text-2xs text-ink-dim">
                      {kit}
                    </span>
                  ))}
                  {template.permissions.map((p) => (
                    <span
                      key={p}
                      className="rounded bg-base-800 px-1.5 py-0.5 font-mono text-2xs text-ink-faint"
                    >
                      {p.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'blueprint' && (
          <Field
            label="Blueprint JSON"
            hint="Paste what another install exported. Ids, parentage and history are not carried — you get an agent that behaves the same, not one that claims the same past."
          >
            <textarea
              rows={14}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='{"kind":"agent-orchestrator/agent","version":1,…}'
              className="w-full font-mono text-xs"
            />
          </Field>
        )}

        {tab === 'blank' && (
          <div className="space-y-3">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Schema Designer" />
            </Field>
            <Field label="What it is for">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Owns the normalised schema."
              />
            </Field>
            <Field label="Standing instructions" hint="What it carries into every turn.">
              <textarea
                rows={7}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full font-mono text-xs"
              />
            </Field>
            <Field label="Toolkits">
              <div className="flex flex-wrap gap-1">
                {availableToolkits.map((kit) => (
                  <button
                    key={kit}
                    onClick={() =>
                      setToolkits((current) =>
                        current.includes(kit)
                          ? current.filter((k) => k !== kit)
                          : [...current, kit]
                      )
                    }
                    className={clsx(
                      'rounded border px-1.5 py-0.5 text-2xs transition-colors',
                      toolkits.includes(kit)
                        ? 'border-accent/50 bg-accent-soft text-accent'
                        : 'border-edge bg-base-800 text-ink-faint hover:text-ink-dim'
                    )}
                  >
                    {kit}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label="Permissions"
              hint="A toolkit is not enough on its own — a tool also needs the permission it declares."
            >
              <div className="flex flex-wrap gap-1">
                {PERMISSIONS.map((permission) => (
                  <button
                    key={permission}
                    onClick={() =>
                      setPermissions((current) =>
                        current.includes(permission as Permission)
                          ? current.filter((p) => p !== permission)
                          : [...current, permission as Permission]
                      )
                    }
                    className={clsx(
                      'rounded border px-1.5 py-0.5 font-mono text-2xs transition-colors',
                      permissions.includes(permission as Permission)
                        ? 'border-accent/50 bg-accent-soft text-accent'
                        : 'border-edge bg-base-800 text-ink-faint hover:text-ink-dim'
                    )}
                  >
                    {permission.toLowerCase()}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded border border-bad/40 bg-bad/10 px-2.5 py-2 text-xs text-bad">
          {error}
        </p>
      )}

      <footer className="mt-4 flex items-center gap-2 border-t border-edge pt-3">
        <span className="flex-1 text-2xs text-ink-faint">
          Created agents sit at the top of the tree until something delegates to them.
        </span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={
            busy ||
            (tab === 'template' && !selected) ||
            (tab === 'blueprint' && !json.trim()) ||
            (tab === 'blank' && !name.trim())
          }
          onClick={() =>
            void finish(async () => {
              if (tab === 'template' && selected) {
                return api.blueprints.fromTemplate(projectId, selected, templateName.trim())
              }
              if (tab === 'blueprint') {
                return api.blueprints.import(projectId, json)
              }
              return api.agents.create({
                projectId,
                name: name.trim(),
                role: 'custom',
                description,
                systemPrompt: prompt,
                permissions,
                toolkitNames: toolkits
              })
            })
          }
        >
          {busy ? 'Creating…' : 'Create agent'}
        </Button>
      </footer>
    </Modal>
  )
}

/**
 * Exports an agent as JSON you can paste somewhere else.
 *
 * Shown rather than downloaded because the destination is usually another
 * window of this same application, and a clipboard round-trip beats a file.
 */
export function ExportAgentModal({
  open,
  agentId,
  onClose
}: {
  open: boolean
  agentId: string
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [json, setJson] = useState('')
  const [copied, setCopied] = useState(false)
  const agent = store.agents.find((a) => a.id === agentId)

  useEffect(() => {
    if (!open) return
    setCopied(false)
    api.blueprints
      .export(agentId)
      .then((blueprint) => setJson(JSON.stringify(blueprint, null, 2)))
      .catch((err) => setJson(`// ${(err as Error).message}`))
  }, [open, agentId])

  return (
    <Modal
      open={open}
      title={
        <span className="flex items-center gap-2">
          <RobotAvatar seed={agentId} size={18} />
          Export {agent?.name ?? 'agent'}
        </span>
      }
      onClose={onClose}
    >
      <textarea
        readOnly
        rows={18}
        value={json}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full font-mono text-xs"
      />
      <footer className="mt-3 flex items-center gap-2">
        <span className="flex-1 text-2xs text-ink-faint">
          Paste this into another project&apos;s New agent → From a blueprint.
        </span>
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(json)
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </footer>
    </Modal>
  )
}
