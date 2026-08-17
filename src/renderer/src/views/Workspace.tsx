import React, { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
// Import the editor core plus only the languages worth highlighting here. The
// `monaco-editor` barrel pulls in every language service and its workers, which
// quadrupled the renderer bundle for no benefit.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
// Highlighting only; the full JSON language service adds a schema validator
// and its own worker for no benefit in a read-mostly editor.
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import { useStore } from '../store'
import { api } from '../api'
import { Badge, Button, EmptyState, StatusDot, Tabs } from '../ui'
import type { FileNode, GitStatus, Worktree } from '@shared/models'

// Monaco needs a worker for tokenisation and word-based suggestions. Bundling
// the real editor worker through Vite gives us a proper module instead of the
// stub blob this used to create - which the renderer's content security policy
// refused to start.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

monaco.editor.defineTheme('ao-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#151210',
    'editor.lineHighlightBackground': '#1c1815',
    'editorLineNumber.foreground': '#7c6d5e',
    'editorGutter.background': '#151210',
    'diffEditor.insertedTextBackground': '#6fbf7322',
    'diffEditor.removedTextBackground': '#e0655222'
  }
})

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  toml: 'ini'
}

function languageFor(file: string): string {
  return LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
}

export function WorkspaceView(): React.JSX.Element {
  const store = useStore()
  const [tab, setTab] = useState<'files' | 'changes' | 'worktrees'>('files')
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [root, setRoot] = useState('')
  const [status, setStatus] = useState<GitStatus | null>(null)

  const projectId = store.activeProjectId

  const refresh = useCallback(async () => {
    if (!projectId) return
    const [rootInfo, gitStatus] = await Promise.all([
      api.files.root(projectId, agentFilter || null),
      api.git.status(projectId, agentFilter || null)
    ])
    setRoot(rootInfo.root)
    setStatus(gitStatus)
  }, [projectId, agentFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!projectId) return <EmptyState title="No project" />

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'files', label: 'Files' },
            {
              id: 'changes',
              label: `Changes${status && !status.clean ? ` ${status.entries.length}` : ''}`
            },
            { id: 'worktrees', label: 'Worktrees' }
          ]}
        />
        <div className="flex-1" />
        <select
          className="h-7 text-xs"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          title="View an agent's isolated worktree"
        >
          <option value="">Shared workspace</option>
          {store.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}&apos;s worktree
            </option>
          ))}
        </select>
        {status?.isRepo ? (
          <Badge tone="accent">{status.branch}</Badge>
        ) : (
          <Button size="sm" onClick={() => void api.git.init(projectId).then(refresh)}>
            git init
          </Button>
        )}
        <span className="mono max-w-[22rem] truncate text-2xs text-ink-faint" title={root}>
          {root}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {tab === 'files' && <FileBrowser projectId={projectId} agentId={agentFilter || null} />}
        {tab === 'changes' && (
          <Changes
            projectId={projectId}
            agentId={agentFilter || null}
            status={status}
            onChanged={refresh}
          />
        )}
        {tab === 'worktrees' && <Worktrees projectId={projectId} onChanged={refresh} />}
      </div>

    </div>
  )
}

function FileBrowser({
  projectId,
  agentId
}: {
  projectId: string
  agentId: string | null
}): React.JSX.Element {
  const [tree, setTree] = useState<Record<string, FileNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']))
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const loadDir = useCallback(
    async (dir: string) => {
      const nodes = await api.files.list(projectId, dir, agentId)
      setTree((current) => ({ ...current, [dir]: nodes }))
    },
    [projectId, agentId]
  )

  useEffect(() => {
    setTree({})
    setExpanded(new Set(['.']))
    setOpenFile(null)
    void loadDir('.')
  }, [loadDir])

  useEffect(() => {
    if (!hostRef.current || editorRef.current) return
    editorRef.current = monaco.editor.create(hostRef.current, {
      value: '',
      language: 'plaintext',
      theme: 'ao-dark',
      automaticLayout: true,
      fontSize: 12,
      lineHeight: 18,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    })
    editorRef.current.onDidChangeModelContent(() => {
      setContent(editorRef.current?.getValue() ?? '')
      setDirty(true)
    })
    return () => {
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  const open = async (file: string): Promise<void> => {
    const result = await api.files.read(projectId, file, agentId)
    setOpenFile(file)
    setContent(result.content)
    setTruncated(result.truncated)
    setDirty(false)
    const editor = editorRef.current
    if (editor) {
      const model = monaco.editor.createModel(result.content, languageFor(file))
      const previous = editor.getModel()
      editor.setModel(model)
      previous?.dispose()
    }
  }

  const save = async (): Promise<void> => {
    if (!openFile) return
    await api.files.write(projectId, openFile, editorRef.current?.getValue() ?? content, agentId)
    setDirty(false)
  }

  const renderDir = (dir: string, depth: number): React.JSX.Element[] => {
    const nodes = tree[dir] ?? []
    return nodes.flatMap((node) => {
      const isOpen = expanded.has(node.path)
      const row = (
        <button
          key={node.path}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={async () => {
            if (node.kind === 'dir') {
              const next = new Set(expanded)
              if (isOpen) next.delete(node.path)
              else {
                next.add(node.path)
                if (!tree[node.path]) await loadDir(node.path)
              }
              setExpanded(next)
            } else {
              await open(node.path)
            }
          }}
          className={clsx(
            'flex w-full items-center gap-1.5 py-0.5 pr-2 text-left text-xs row-hover',
            openFile === node.path ? 'bg-base-750 text-ink' : 'text-ink-dim'
          )}
        >
          <span className="w-3 text-ink-faint">
            {node.kind === 'dir' ? (isOpen ? '▾' : '▸') : ''}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
      )
      return node.kind === 'dir' && isOpen ? [row, ...renderDir(node.path, depth + 1)] : [row]
    })
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="scroll-y w-60 shrink-0 border-r border-edge py-1">
        {(tree['.'] ?? []).length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-faint">This workspace is empty.</p>
        )}
        {renderDir('.', 0)}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-1.5">
          <span className="mono truncate text-xs text-ink-dim">{openFile ?? 'No file open'}</span>
          {truncated && <Badge tone="warn">truncated</Badge>}
          {dirty && <Badge tone="warn">unsaved</Badge>}
          <div className="flex-1" />
          <Button size="sm" disabled={!openFile || !dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
        <div ref={hostRef} className={clsx('min-h-0 flex-1', !openFile && 'opacity-40')} />
      </div>
    </div>
  )
}

function Changes({
  projectId,
  agentId,
  status,
  onChanged
}: {
  projectId: string
  agentId: string | null
  status: GitStatus | null
  onChanged(): void
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selected) return
    void api.git.diff(projectId, selected, agentId).then((r) => setDiff(r.diff))
  }, [selected, projectId, agentId])

  if (!status?.isRepo) {
    return (
      <EmptyState
        title="Not a git repository"
        detail="Initialise git in this workspace to see what agents changed, file by file."
      />
    )
  }

  if (status.clean) {
    return <EmptyState title="Working tree clean" detail="No uncommitted changes here." />
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-edge">
        <div className="scroll-y flex-1 py-1">
          {status.entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => setSelected(entry.path)}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-1 text-left text-xs row-hover',
                selected === entry.path ? 'bg-base-750' : ''
              )}
            >
              <span
                className={clsx(
                  'mono w-5 shrink-0',
                  entry.untracked ? 'text-good' : entry.staged ? 'text-accent' : 'text-warn'
                )}
              >
                {entry.untracked ? '+' : `${entry.index}${entry.worktree}`.trim()}
              </span>
              <span className="truncate text-ink-dim">{entry.path}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-edge p-2">
          <textarea
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
            className="mb-1.5 w-full text-xs"
          />
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            disabled={!message.trim() || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.git.commit(projectId, message, agentId)
                setMessage('')
                setSelected(null)
                onChanged()
              } finally {
                setBusy(false)
              }
            }}
          >
            Commit all changes
          </Button>
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto bg-base-900 p-3">
        {selected ? (
          <pre className="mono text-2xs leading-relaxed">
            {diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={clsx(
                  line.startsWith('+') && !line.startsWith('+++') && 'text-good',
                  line.startsWith('-') && !line.startsWith('---') && 'text-bad',
                  line.startsWith('@@') && 'text-accent',
                  line.startsWith('diff ') && 'text-ink-faint'
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        ) : (
          <p className="text-xs text-ink-faint">Select a file to see what changed.</p>
        )}
      </div>
    </div>
  )
}

function Worktrees({
  projectId,
  onChanged
}: {
  projectId: string
  onChanged(): void
}): React.JSX.Element {
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setWorktrees(await api.git.worktrees(projectId))
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selected) return
    void api.git.worktreeDiff(projectId, selected).then((r) => setDiff(r.diff))
  }, [selected, projectId])

  return (
    <div className="flex h-full min-h-0">
      <div className="w-80 shrink-0 overflow-y-auto border-r border-edge">
        {worktrees.length === 0 && (
          <p className="p-3 text-xs text-ink-faint">
            No worktrees. Turn on workspace isolation in Settings and each agent gets its own
            checkout and branch, so concurrent work cannot collide.
          </p>
        )}
        {worktrees.map((tree) => (
          <div key={tree.path} className="border-b border-edge-soft p-2.5">
            <div className="flex items-center gap-2">
              <StatusDot status={tree.isMain ? 'COMPLETED' : 'IDLE'} />
              <span className="mono min-w-0 flex-1 truncate text-xs">
                {tree.branch ?? '(detached)'}
              </span>
              {tree.isMain && <Badge>main</Badge>}
            </div>
            {tree.agent && <div className="mt-0.5 pl-3.5 text-2xs text-ink-dim">{tree.agent}</div>}
            <div className="mt-0.5 truncate pl-3.5 text-2xs text-ink-faint" title={tree.path}>
              {tree.path}
            </div>
            {!tree.isMain && tree.branch && (
              <div className="mt-1.5 flex gap-1.5 pl-3.5">
                <Button size="sm" onClick={() => setSelected(tree.branch as string)}>
                  Diff
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    setError(null)
                    try {
                      await api.git.merge(projectId, tree.branch as string)
                      await load()
                      onChanged()
                    } catch (err) {
                      setError((err as Error).message)
                    }
                  }}
                >
                  Merge
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    setError(null)
                    try {
                      await api.git.removeWorktree(projectId, tree.path, true)
                      await load()
                    } catch (err) {
                      setError((err as Error).message)
                    }
                  }}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-auto bg-base-900 p-3">
        {error && (
          <div className="mb-2 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error}
          </div>
        )}
        {selected ? (
          <pre className="mono text-2xs leading-relaxed">
            {diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={clsx(
                  line.startsWith('+') && !line.startsWith('+++') && 'text-good',
                  line.startsWith('-') && !line.startsWith('---') && 'text-bad',
                  line.startsWith('@@') && 'text-accent'
                )}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        ) : (
          <p className="text-xs text-ink-faint">
            Select a worktree to see everything that agent changed, then merge or discard it.
          </p>
        )}
      </div>
    </div>
  )
}
