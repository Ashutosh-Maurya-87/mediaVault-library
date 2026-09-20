import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Keeping the page usable even when a render-time component failure occurs.
  }

  render() {
    if (this.state.hasError) {
      return <main className="fatal-state"><h1>MediaVault needs a refresh</h1><p>One part of the library stopped responding.</p><button onClick={() => this.setState({ hasError: false })}>Try again</button></main>;
    }
    return this.props.children;
  }
}