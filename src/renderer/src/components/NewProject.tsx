import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { api } from '../api'
import { useStore } from '../store'
import { Button, Field, Modal } from '../ui'
import type { ProjectTemplateInfo, ProviderInfo } from '@shared/models'

export function NewProjectModal({
  open,
  onClose
}: {
  open: boolean
  onClose(): void
}): React.JSX.Element {
  const store = useStore()
  const [templates, setTemplates] = useState<ProjectTemplateInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [name, setName] = useState('')
  const [mission, setMission] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [templateId, setTemplateId] = useState('software')
  const [criteria, setCriteria] = useState('')
  const [provider, setProvider] = useState('claude-code')
  const [model, setModel] = useState('sonnet')
  const [autoStart, setAutoStart] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    void api.projects.templates().then(setTemplates)
    void api.providers.list().then((list) => {
      setProviders(list)
      const firstAvailable = list.find((p) => p.availability?.available)
      if (firstAvailable) setProvider(firstAvailable.id)
    })
  }, [open])

  const template = templates.find((t) => t.id === templateId)

  const submit = async (): Promise<void> => {
    if (!name.trim() || !mission.trim()) {
      setError('A project needs a name and a mission.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { project } = await api.projects.createFromMission({
        name: name.trim(),
        mission: mission.trim(),
        templateId,
        rootPath: rootPath.trim() || null,
        autoStart,
        acceptanceCriteria: criteria
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        settings: { defaultProvider: provider, defaultModel: model }
      })
      await store.refreshProjects()
      await store.selectProject(project.id)
      setName('')
      setMission('')
      setCriteria('')
      setRootPath('')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="New project" onClose={onClose} width="max-w-3xl">
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Greeting library" />
        </Field>

        <Field
          label="Mission"
          hint="Describe the outcome, not the steps. The Orchestrator decides which agents the mission needs."
        >
          <textarea
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            rows={3}
            placeholder="Build a small, well-tested library that formats greetings for our onboarding emails."
          />
        </Field>

        <div>
          <label>Template</label>
          <div className="mt-1 grid grid-cols-2 gap-2 lg:grid-cols-3">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={clsx(
                  'rounded border p-2.5 text-left transition-colors',
                  templateId === t.id
                    ? 'border-accent bg-accent-soft/25'
                    : 'border-edge bg-base-800 hover:border-edge-bright'
                )}
              >
                <div className="text-sm">{t.name}</div>
                <div className="mt-0.5 text-xs text-ink-faint">{t.description}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.availability && !p.availability.available ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model" hint='Use "auto" to route by task weight.'>
            <input value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
        </div>

        <Field
          label="Workspace folder"
          hint="Where file tools may read and write. Leave blank to use a managed folder inside the app's data directory."
        >
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="/Users/you/code/my-project"
          />
        </Field>

        <Field
          label="Acceptance criteria"
          hint={
            template?.suggestedCriteria.length
              ? `One per line. Suggested: ${template.suggestedCriteria.join('; ')}`
              : 'One per line. These are what the Judge scores the project against.'
          }
        >
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={3}
            placeholder={template?.suggestedCriteria.join('\n')}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Start the Orchestrator immediately
        </label>

        {providers.find((p) => p.id === provider)?.availability?.available === false && (
          <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {providers.find((p) => p.id === provider)?.availability?.detail}
          </p>
        )}

        {error && (
          <p className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : autoStart ? 'Create and run' : 'Create'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
