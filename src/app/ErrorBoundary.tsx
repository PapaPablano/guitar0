import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Catches a crash while drawing so the page shows a message and a way back instead of going blank. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Tab Highway crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app">
        <section className="dropzone" role="alert">
          <h1>Something went wrong</h1>
          <p className="error">{this.state.error.message || 'An unexpected error stopped the page.'}</p>
          <div className="actions">
            <button type="button" onClick={() => this.setState({ error: null })}>
              Back to the start
            </button>
          </div>
        </section>
      </main>
    );
  }
}
