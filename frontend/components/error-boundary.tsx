"use client"
import { Component, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center bg-background text-foreground">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold">Something went wrong</h1>
          <p className="text-muted-foreground max-w-sm">
            An unexpected error occurred. Refresh the page to continue.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
          >
            Refresh
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
