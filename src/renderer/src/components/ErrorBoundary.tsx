import React from 'react'
import { Button } from '../ui'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

/**
 * Keeps a rendering fault in one view from blanking the whole window.
 *
 * A long-running control surface that goes white because a single panel threw
 * is worse than one that shows what broke and lets you carry on elsewhere.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] view crashed', error, info.componentStack)
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-md text-bad">This view hit an error</p>
        <p className="max-w-lg mono text-xs text-ink-dim">{this.state.error.message}</p>
        <p className="max-w-lg text-xs text-ink-faint">
          The rest of the application is still running - agents keep working, and nothing was lost.
        </p>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}
