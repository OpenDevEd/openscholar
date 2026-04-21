"use client";

import { Component, type ReactNode } from "react";

import { TransactionsErrorBanner } from "./transactions-error-banner";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: number;
}

/**
 * Catches render-time errors thrown by `useProtectedPaginatedQuery` (Convex's
 * paginated hook has no `status: "error"` variant — it throws). Renders the
 * inline banner with a retry button that remounts children via key-bump.
 */
export class TransactionsErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    if (typeof console !== "undefined") {
      console.error("[TransactionsPanel] query error:", error);
    }
  }

  private reset = (): void => {
    this.setState((prev) => ({ error: null, resetKey: prev.resetKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <TransactionsErrorBanner
          onRetry={this.reset}
          message={this.state.error.message}
        />
      );
    }
    return (
      <ErrorBoundaryChildren resetKey={this.state.resetKey}>
        {this.props.children}
      </ErrorBoundaryChildren>
    );
  }
}

/**
 * A tiny inner wrapper so that `resetKey` forces a full remount of the
 * subtree on retry — including the Convex hook subscription.
 */
function ErrorBoundaryChildren({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey: number;
}): ReactNode {
  return <div key={resetKey} data-transactions-error-boundary-scope>{children}</div>;
}
