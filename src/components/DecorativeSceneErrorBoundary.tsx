import { Component, type ReactNode } from "react";

interface DecorativeSceneErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onFailure?: (error: Error) => void;
}
interface DecorativeSceneErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Isolates the optional renderer from the semantic DOM game underneath it.
 * This catches lazy-chunk rejection as well as render-time scene failures;
 * returning null is intentional because the scene is purely decorative.
 */
export class DecorativeSceneErrorBoundary extends Component<
  DecorativeSceneErrorBoundaryProps,
  DecorativeSceneErrorBoundaryState
> {
  state: DecorativeSceneErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DecorativeSceneErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onFailure?.(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
