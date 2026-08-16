import React from 'react'
import clsx from 'clsx'
import { useStore, type DocTab } from '../store'
import { RobotAvatar } from './RobotAvatar'

const GLYPH: Record<string, string> = {
  report: '◱',
  graph: '⌗',
  agents: '◈',
  tasks: '☰',
  workflows: '⑂',
  automation: '⟳',
  workspace: '⌘',
  memory: '❖',
  settings: '⚙',
  dashboard: '◱'
}

/**
 * The open documents, along the bottom of the centre column.
 *
 * Along the bottom rather than the top because the pane above is a document and
 * the pane below is a terminal: putting the tabs between them keeps the reading
 * surface flush with the window's own title bar and the controls near the hand.
 */
export function DocTabs(): React.JSX.Element {
  const store = useStore()

  return (
    <div
      data-pane="tabs"
      className="flex h-8 shrink-0 items-stretch gap-px overflow-x-auto border-t border-edge bg-base-850"
    >
      {store.tabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} active={tab.id === store.activeTabId} />
      ))}
      <div className="flex-1" />
    </div>
  )
}

function TabButton({ tab, active }: { tab: DocTab; active: boolean }): React.JSX.Element {
  const store = useStore()
  const glyph = tab.kind === 'view' ? GLYPH[tab.view] : tab.kind === 'report' ? GLYPH.report : null

  return (
    <div
      className={clsx(
        'group flex min-w-0 max-w-52 shrink-0 items-center gap-1.5 border-r border-edge px-2.5 text-xs transition-colors',
        active ? 'bg-base-800 text-ink' : 'text-ink-faint hover:bg-base-800/60 hover:text-ink-dim'
      )}
    >
      <button
        className="flex min-w-0 items-center gap-1.5 py-1"
        onClick={() => store.activateTab(tab.id)}
        title={tab.title}
      >
        {tab.kind === 'agent' ? (
          <RobotAvatar seed={tab.agentId} size={14} />
        ) : (
          <span className="text-ink-faint">{glyph}</span>
        )}
        <span className="truncate">{tab.title}</span>
      </button>
      <button
        className="shrink-0 text-ink-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
        onClick={() => store.closeTab(tab.id)}
        title="Close"
      >
        ✕
      </button>
    </div>
  )
}
