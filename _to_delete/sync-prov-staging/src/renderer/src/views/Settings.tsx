import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, Field, Panel, StatusDot } from '../ui'
import { DEFAULT_SAFETY_LIMITS, type ProjectSettings, type SafetyLimits } from '@shared/domain'
import type { BillingState, LocalConfig, MailConfig, ProviderInfo } from '@shared/models'

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

          <BillingChoice onChanged={() => void api.providers.check().then(setProviders)} />

          <div className="mt-4 border-t border-edge pt-3">
            <Field
              label="Anthropic API key"
              hint={
                hasKey
                  ? 'A key is stored. Entering a new one replaces it.'
                  : 'Only needed for the direct API provider, or if you set the billing account above to API credits.'
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

        <LocalModelsPanel />

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
 * Which account pays.
 *
 * The Claude Code CLI's own precedence puts an API key above the subscription
 * you signed in with, so an ANTHROPIC_API_KEY sitting in the shell that launched
 * this app will quietly spend credits belonging to someone already paying for a
 * plan. The application refuses to let that be an accident: it says which
 * account a run would use, and the choice is made here rather than by the
 * environment.
 */
function BillingChoice({ onChanged }: { onChanged(): void }): React.JSX.Element {
  const [mode, setMode] = useState<'subscription' | 'api-key'>('subscription')
  const [verdict, setVerdict] = useState<BillingState | null>(null)

  const refresh = async (): Promise<void> => {
    const state = await api.providers.billing()
    setVerdict(state)
    setMode(state.mode)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const choose = async (next: 'subscription' | 'api-key'): Promise<void> => {
    setMode(next)
    await api.providers.setSecret('claude.billingMode', next === 'api-key' ? 'api-key' : null)
    await refresh()
    onChanged()
  }

  return (
    <div className="mt-4 border-t border-edge pt-3">
      <Field
        label="Billing account for the Claude Code CLI"
        hint="The CLI prefers an API key over your plan whenever it can see one. This decides what it is allowed to see."
      >
        <div className="flex flex-col gap-2">
          <Choice
            checked={mode === 'subscription'}
            onSelect={() => void choose('subscription')}
            title="My Claude subscription"
            detail="Runs use the account you signed in with via claude login. Any API key in the environment is kept out of the run."
          />
          <Choice
            checked={mode === 'api-key'}
            onSelect={() => void choose('api-key')}
            title="Anthropic API credits"
            detail="Runs are billed pay-as-you-go against the key below, or one already set in your environment."
          />
        </div>
      </Field>

      {verdict && (
        <div
          className={clsx(
            'mt-2 rounded border px-2.5 py-2 text-xs',
            verdict.account === 'subscription'
              ? 'border-good/40 bg-good/10 text-good'
              : 'border-warn/40 bg-warn/10 text-warn'
          )}
        >
          <span className="mr-1 uppercase tracking-wider text-2xs">
            {verdict.account === 'subscription'
              ? 'plan'
              : verdict.account === 'api-key'
                ? 'api credits'
                : 'gateway'}
          </span>
          {verdict.detail}
        </div>
      )}
    </div>
  )
}

function Choice({
  checked,
  onSelect,
  title,
  detail
}: {
  checked: boolean
  onSelect(): void
  title: string
  detail: string
}): React.JSX.Element {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2',
        checked ? 'border-accent/50 bg-accent-soft/20' : 'border-edge bg-base-800'
      )}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-3.5 w-3.5"
      />
      <span className="min-w-0">
        <span className="block text-sm normal-case tracking-normal text-ink">{title}</span>
        <span className="mt-0.5 block text-xs normal-case leading-relaxed tracking-normal text-ink-faint">
          {detail}
        </span>
      </span>
    </label>
  )
}

/**
 * Models running on this machine.
 *
 * One provider for every OpenAI-compatible server rather than one per vendor:
 * LM Studio, Ollama, llama.cpp and vLLM differ by a port. The model list comes
 * from the server itself, so what you can pick is what is actually loaded.
 */
function LocalModelsPanel(): React.JSX.Element {
  const [config, setConfig] = useState<LocalConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    void api.local.config().then((value) => {
      setConfig(value)
      setBaseUrl(value.baseUrl)
      if (value.baseUrl) void api.local.models(value.baseUrl).then(setModels)
    })
  }, [])

  const detect = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    const found = await api.local.detect()
    setBusy(false)
    if (!found.length) {
      setNote(
        'Nothing found on the usual ports. Start LM Studio, Ollama or another OpenAI-compatible server, or type its address.'
      )
      return
    }
    const first = found[0]
    setBaseUrl(first.baseUrl)
    setModels(first.models)
    const saved = await api.local.save({ baseUrl: first.baseUrl, model: first.models[0] ?? '' })
    setConfig(saved)
    setNote(`Found ${first.label} with ${first.models.length} model${first.models.length === 1 ? '' : 's'}.`)
  }

  const load = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    const list = await api.local.models(baseUrl)
    setModels(list)
    setBusy(false)
    if (!list.length) {
      setNote(`Nothing answered at that address. Is the server running?`)
      return
    }
    const saved = await api.local.save({ baseUrl, model: config?.model || list[0] })
    setConfig(saved)
  }

  if (!config) return <Panel title="Local models">Loading…</Panel>

  return (
    <Panel
      title="Local models"
      actions={
        <Badge tone={config.baseUrl && models.length ? 'good' : 'neutral'}>
          {config.baseUrl && models.length ? `${models.length} available` : 'not configured'}
        </Badge>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-faint">
        Any server speaking the OpenAI API works here — LM Studio, Ollama, llama.cpp, vLLM. Tool
        calls still go through the same permission gate as every other provider, so agent work
        needs a model that supports tool calling; one that only chats will say so rather than
        appearing to work.
      </p>

      <div className="flex flex-col gap-3">
        <Field label="Server address" hint="The OpenAI-compatible base URL. /v1 is added if you leave it off.">
          <div className="flex gap-2">
            <input
              value={baseUrl}
              className="mono flex-1"
              placeholder="http://127.0.0.1:1234/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <Button onClick={() => void load()} disabled={busy || !baseUrl.trim()}>
              Connect
            </Button>
            <Button variant="ghost" onClick={() => void detect()} disabled={busy}>
              Detect
            </Button>
          </div>
        </Field>

        <Field
          label="Default model"
          hint={
            models.length
              ? 'What the server is serving. An agent can still name its own.'
              : 'Connect to a server to see what it has loaded.'
          }
        >
          <select
            value={config.model}
            disabled={!models.length}
            className="mono w-full"
            onChange={async (e) => setConfig(await api.local.save({ model: e.target.value }))}
          >
            <option value="">{models.length ? 'Choose one…' : 'No models'}</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </Field>

        {note && <p className="text-xs text-ink-dim">{note}</p>}

        <p className="text-2xs leading-relaxed text-ink-faint">
          To use these, set a project or an agent to the <span className="mono">local</span>{' '}
          provider. Runs cost nothing and are recorded as such; tokens are still counted, because
          that is what tells you a model is looping.
        </p>
      </div>
    </Panel>
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
