import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, Field, Panel, StatusDot } from '../ui'
import { DEFAULT_SAFETY_LIMITS, type ProjectSettings, type SafetyLimits } from '@shared/domain'
import type { MailConfig, ProviderInfo } from '@shared/models'

const LIMIT_LABELS: Record<keyof SafetyLimits, { label: string; hint: string }> = {
  maxDepth: { label: 'Max depth', hint: 'How many generations of agents may exist below the top level.' },
  maxChildrenPerAgent: { label: 'Max children per agent', hint: 'Fan-out limit for a single agent.' },
  maxTotalAgents: { label: 'Max agents', hint: 'Hard ceiling on the fleet size for this project.' },
  maxConcurrentExecutions: { label: 'Max concurrent runs', hint: 'How many agents may execute at once.' },
  maxIterationsPerExecution: { label: 'Max turns per run', hint: 'Stops a single execution looping forever.' },
  maxRuntimeMsPerExecution: { label: 'Max runtime per run (ms)', hint: 'The watchdog terminates past this.' },
  maxToolCallsPerExecution: { label: 'Max tool calls per run', hint: 'Caps tool thrashing.' },
  maxCostUsdPerTask: { label: 'Max cost per task ($)', hint: 'Asks for a human decision when reached.' },
  maxCostUsdPerProject: { label: 'Max cost per project ($)', hint: 'Pauses the project when reached.' },
  maxTasksPerProject: { label: 'Max tasks', hint: 'Ceiling on generated work.' },
  maxRevisionsPerTask: { label: 'Max revisions per task', hint: 'How many times the Judge may send work back.' }
}

export function SettingsView(): React.JSX.Element {
  const store = useStore()
  const project = store.projects.find((p) => p.id === store.activeProjectId)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [settings, setSettings] = useState<ProjectSettings | null>(project?.settings ?? null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setSettings(project?.settings ?? null)
  }, [project?.id, project?.settings])

  useEffect(() => {
    void api.providers.list().then(setProviders)
    void api.providers.hasSecret('anthropic.apiKey').then((r) => setHasKey(r.present))
  }, [])

  const save = async (next: ProjectSettings): Promise<void> => {
    if (!project) return
    setSettings(next)
    await api.projects.update(project.id, { settings: next })
    await store.refreshProjects()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!project || !settings) return <div className="p-4 text-sm text-ink-faint">No project.</div>

  return (
    <div className="scroll-y h-full p-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Panel title="Providers">
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="flex items-start gap-2 rounded border border-edge bg-base-800 px-2.5 py-2"
              >
                <StatusDot status={provider.availability?.available ? 'RUNNING' : 'FAILED'} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{provider.label}</span>
                    <Badge>{provider.kind}</Badge>
                    <span className="mono text-2xs text-ink-faint">{provider.id}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {provider.availability?.detail ?? 'Not checked yet.'}
                  </p>
                </div>
              </div>
            ))}
            <Button
              size="sm"
              onClick={() => void api.providers.check().then(setProviders)}
              className="self-start"
            >
              Re-check providers
            </Button>
          </div>

          <div className="mt-4 border-t border-edge pt-3">
            <Field
              label="Anthropic API key"
              hint={
                hasKey
                  ? 'A key is stored. Entering a new one replaces it.'
                  : 'Only needed for the direct API provider. The Claude Code CLI provider uses your existing subscription.'
              }
            >
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? '••••••••••••' : 'sk-ant-…'}
                  className="flex-1"
                />
                <Button
                  onClick={async () => {
                    await api.providers.setSecret('anthropic.apiKey', apiKey || null)
                    setApiKey('')
                    setHasKey(Boolean(apiKey))
                    await api.providers.check().then(setProviders)
                  }}
                >
                  Save
                </Button>
              </div>
            </Field>
          </div>
        </Panel>

        <Panel title="Judging">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pass threshold" hint="At or above this, work is approved.">
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.judgePassThreshold}
                  onChange={(e) =>
                    void save({ ...settings, judgePassThreshold: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Escalate threshold" hint="Below this, a human is asked instead.">
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={settings.judgeEscalateThreshold}
                  onChange={(e) =>
                    void save({ ...settings, judgeEscalateThreshold: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
              <input
                type="checkbox"
                checked={settings.autoJudge}
                className="h-3.5 w-3.5"
                onChange={(e) => void save({ ...settings, autoJudge: e.target.checked })}
              />
              Judge every completed task automatically
            </label>
            <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
              <input
                type="checkbox"
                checked={settings.autoRevise}
                className="h-3.5 w-3.5"
                onChange={(e) => void save({ ...settings, autoRevise: e.target.checked })}
              />
              Create a revision task when the Judge rejects work
            </label>
            <label className="flex items-start gap-2 text-sm normal-case tracking-normal text-ink-dim">
              <input
                type="checkbox"
                checked={settings.isolateAgentWorkspaces}
                className="mt-1 h-3.5 w-3.5"
                onChange={(e) => void save({ ...settings, isolateAgentWorkspaces: e.target.checked })}
              />
              <span>
                Give each agent its own git worktree
                <span className="block text-xs text-ink-faint">
                  Concurrent agents edit the same repository without overwriting each other. Review
                  and merge each branch from the Workspace view. Needs the workspace to be a git
                  repository.
                </span>
              </span>
            </label>
            <Field label="Judge model" hint="Leave blank to use the project default model.">
              <input
                value={settings.judgeModel ?? ''}
                onChange={(e) =>
                  void save({ ...settings, judgeModel: e.target.value || undefined })
                }
              />
            </Field>
          </div>
        </Panel>

        <Panel
          title="Safety limits"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void save({ ...settings, limits: DEFAULT_SAFETY_LIMITS })}
            >
              Reset to defaults
            </Button>
          }
        >
          <p className="mb-3 text-xs text-ink-faint">
            Recursion is bounded by budget and permission, not by architecture. Raise these
            deliberately: an agent that can create agents can create work faster than you can read
            it.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(LIMIT_LABELS) as Array<keyof SafetyLimits>).map((key) => (
              <Field key={key} label={LIMIT_LABELS[key].label} hint={LIMIT_LABELS[key].hint}>
                <input
                  type="number"
                  value={settings.limits[key]}
                  onChange={(e) =>
                    void save({
                      ...settings,
                      limits: { ...settings.limits, [key]: Number(e.target.value) }
                    })
                  }
                />
              </Field>
            ))}
          </div>
        </Panel>

        <Panel title="Project">
          <div className="flex flex-col gap-3">
            <Field label="Name">
              <input
                defaultValue={project.name}
                onBlur={(e) =>
                  void api.projects
                    .update(project.id, { name: e.target.value })
                    .then(() => store.refreshProjects())
                }
              />
            </Field>
            <Field label="Mission">
              <textarea
                defaultValue={project.mission}
                rows={3}
                onBlur={(e) =>
                  void api.projects
                    .update(project.id, { mission: e.target.value })
                    .then(() => store.refreshProjects())
                }
              />
            </Field>
            <Field
              label="Instructions"
              hint="Prepended to every agent's system prompt on this project."
            >
              <textarea
                defaultValue={project.instructions}
                rows={4}
                onBlur={(e) =>
                  void api.projects
                    .update(project.id, { instructions: e.target.value })
                    .then(() => store.refreshProjects())
                }
              />
            </Field>
            <Field label="Workspace folder" hint="Where file tools may read and write.">
              <input
                defaultValue={project.rootPath ?? ''}
                placeholder="Managed folder inside the app data directory"
                onBlur={(e) =>
                  void api.projects
                    .update(project.id, { rootPath: e.target.value || null })
                    .then(() => store.refreshProjects())
                }
              />
            </Field>

            <div className="border-t border-edge pt-3">
              <p className="mb-3 text-xs text-ink-faint">
                The Release toolkit runs these rather than guessing what your project uses. Left
                blank, the tools that need them refuse and say so.
              </p>
              <div className="flex flex-col gap-3">
                <Field
                  label="Dev server command"
                  hint="What the dev_server tool starts, e.g. npm run dev."
                >
                  <input
                    key={`dev-${project.id}`}
                    defaultValue={settings.devServerCommand ?? ''}
                    placeholder="npm run dev"
                    className="mono"
                    onBlur={(e) =>
                      void save({ ...settings, devServerCommand: e.target.value })
                    }
                  />
                </Field>
                <Field
                  label="Editor command"
                  hint="What open_in_editor runs, e.g. code. Blank uses the platform default."
                >
                  <input
                    key={`editor-${project.id}`}
                    defaultValue={settings.editorCommand ?? ''}
                    placeholder={
                      navigator.platform.startsWith('Mac') ? 'code (default: open)' : 'code'
                    }
                    className="mono"
                    onBlur={(e) => void save({ ...settings, editorCommand: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={async () => {
                  await api.projects.archive(project.id)
                  await store.refreshProjects()
                  await store.selectProject(null)
                }}
              >
                Archive project
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await api.projects.remove(project.id)
                  await store.refreshProjects()
                  await store.selectProject(null)
                }}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        </Panel>

        <EmailPanel />
      </div>

      <div
        className={clsx(
          'pointer-events-none fixed bottom-20 right-6 rounded border border-good/40 bg-good/10 px-3 py-1.5 text-xs text-good transition-opacity',
          saved ? 'opacity-100' : 'opacity-0'
        )}
      >
        Saved
      </div>
    </div>
  )
}

/**
 * The SMTP account the send_email tool uses.
 *
 * Until this is filled in, that tool refuses and says why - it does not report a
 * send that never happened. "Test the connection" opens a real socket and says
 * EHLO, so a wrong host or a wrong password fails here, where you are looking,
 * rather than inside an agent's run at two in the morning.
 */
function EmailPanel(): React.JSX.Element {
  const [config, setConfig] = useState<MailConfig | null>(null)
  const [password, setPassword] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)

  useEffect(() => {
    void api.mail.config().then((value) => {
      setConfig(value)
      setDraft({
        host: value.host,
        port: String(value.port),
        user: value.user,
        from: value.from,
        secure: value.secure ? 'true' : 'false'
      })
    })
  }, [])

  const field = (key: string): string => draft[key] ?? ''
  const set = (key: string, value: string): void => setDraft({ ...draft, [key]: value })

  const saveAccount = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    const payload = { ...draft }
    if (password) payload.password = password
    const next = await api.mail.save(payload)
    setConfig(next)
    setPassword('')
    setBusy(false)
  }

  if (!config) return <Panel title="Email">Loading…</Panel>

  return (
    <Panel
      title="Email"
      actions={
        <Badge tone={config.configured ? 'good' : 'neutral'}>
          {config.configured ? 'configured' : 'not configured'}
        </Badge>
      }
    >
      <p className="mb-3 text-xs text-ink-faint">
        An outbound SMTP account for the <span className="mono">send_email</span> tool. The password
        is stored with the other credentials, never in the project file. Until an account is here,
        the tool refuses rather than pretending to send.
      </p>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Host" hint="e.g. smtp.gmail.com">
              <input
                value={field('host')}
                className="mono"
                placeholder="smtp.example.com"
                onChange={(e) => set('host', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Port" hint="587 for STARTTLS, 465 for TLS.">
            <input
              type="number"
              value={field('port')}
              className="mono"
              onChange={(e) => set('port', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Username">
          <input
            value={field('user')}
            className="mono"
            placeholder="you@example.com"
            onChange={(e) => set('user', e.target.value)}
          />
        </Field>

        <Field
          label="Password"
          hint={
            config.configured
              ? 'A password is stored. Type a new one to replace it.'
              : 'For Gmail and iCloud this must be an app-specific password.'
          }
        >
          <input
            type="password"
            value={password}
            className="mono"
            placeholder={config.configured ? '••••••••••••' : ''}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Field label="From address" hint="What recipients see. Usually the same as the username.">
          <input
            value={field('from')}
            className="mono"
            placeholder="you@example.com"
            onChange={(e) => set('from', e.target.value)}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm normal-case tracking-normal text-ink-dim">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={field('secure') === 'true'}
            onChange={(e) => set('secure', e.target.checked ? 'true' : 'false')}
          />
          Connect over TLS directly (port 465) instead of upgrading with STARTTLS
        </label>

        <div className="flex items-center gap-2">
          <Button onClick={() => void saveAccount()} disabled={busy}>
            Save account
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !config.configured}
            onClick={async () => {
              setBusy(true)
              setResult(await api.mail.verify())
              setBusy(false)
            }}
          >
            Test the connection
          </Button>
          {busy && <span className="text-xs text-ink-faint">Working…</span>}
        </div>

        {result && (
          <div
            className={clsx(
              'rounded border px-2.5 py-2 text-xs',
              result.ok ? 'border-good/40 bg-good/10 text-good' : 'border-bad/40 bg-bad/10 text-bad'
            )}
          >
            {result.detail}
          </div>
        )}
      </div>
    </Panel>
  )
}
