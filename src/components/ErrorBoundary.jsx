import { Component } from 'react'

/**
 * The floor's last line of defense: a component crash renders an explanation
 * instead of a blank white page. A blank page with no information is the
 * worst possible failure mode for a tool in live use — this one names the
 * error, offers a retry (state-only reset for transient render bugs), and a
 * full reload.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // The console keeps the full stack for diagnosis.
    console.error('Render crash caught by ErrorBoundary:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-5">
          <h1 className="text-base font-semibold text-red-700">Something broke on this screen</h1>
          <p className="mt-1 text-sm text-zinc-600">
            The app hit an error it couldn't recover from. Your data is safe — nothing was saved
            or lost by this crash.
          </p>
          <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-zinc-100 p-2.5 text-xs whitespace-pre-wrap text-zinc-700">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Reload the app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
