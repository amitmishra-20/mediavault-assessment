import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Last line of defence: a render crash in any subtree replaces the UI with a
 * calm recovery state instead of a white screen. A full reload clears it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('MediaVault UI crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="state" role="alert">
            <p className="state__title">Something went wrong rendering the library</p>
            <p className="state__detail">{String(this.state.error.message || this.state.error)}</p>
            <button onClick={() => window.location.reload()}>Reload the page</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}