import {
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

/**
 * Target load budget for a mode-to-scene transition, mirroring
 * `config/performance-budgets.json` `desktop.modeSelectToTableReadyMs`. When a
 * lazy scene exceeds this, the loading UI surfaces a cancel/back affordance so a
 * slow load is never a dead end.
 */
export const SCENE_LOAD_BUDGET_MS = 1_500;

// Infer the whole component type T (not its props) so `React.lazy`'s
// contravariant `ComponentType<P>` parameter does not collapse P to `never`;
// the wrapper only augments the lazy component with an idempotent `preload()`.
export type PreloadableComponent<T extends ComponentType<any>> =
  LazyExoticComponent<T> & { preload: () => Promise<unknown> };

/**
 * `React.lazy` augmented with an idempotent `preload()` so the next likely
 * scene can be fetched ahead of navigation without rendering it.
 */
export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let started: Promise<{ default: T }> | null = null;
  const load = () => {
    started ??= factory();
    return started;
  };
  // `lazy(load)` is a LazyExoticComponent<T>; the cast only adds the `preload`
  // field assigned immediately below.
  const Component = lazy(load) as PreloadableComponent<T>;
  Component.preload = load;
  return Component;
}

export interface SceneLoadingFallbackProps {
  label: string;
  /** Budget after which a cancel/back path appears. */
  budgetMs?: number;
  /** Invoked by the cancel/back control; omit to hide it. */
  onCancel?: () => void;
  cancelLabel?: string;
}

/**
 * Suspense fallback for a lazily loaded scene. Shows an indeterminate progress
 * indicator immediately and, once the load exceeds the budget, reveals a
 * cancel/back control so the player is never trapped waiting.
 */
export function SceneLoadingFallback({
  label,
  budgetMs = SCENE_LOAD_BUDGET_MS,
  onCancel,
  cancelLabel = "Cancel and go back",
}: SceneLoadingFallbackProps) {
  const [exceededBudget, setExceededBudget] = useState(false);

  useEffect(() => {
    setExceededBudget(false);
    const timer = window.setTimeout(() => setExceededBudget(true), budgetMs);
    return () => window.clearTimeout(timer);
  }, [budgetMs, label]);

  return (
    <main className="scene-loading" aria-labelledby="scene-loading-title">
      <section className="scene-loading__panel" role="status" aria-live="polite">
        <p className="scene-loading__eyebrow">Poker Training Pro</p>
        <h1 id="scene-loading-title">{label}</h1>
        <div
          className="scene-loading__progress"
          role="progressbar"
          aria-valuetext={exceededBudget ? "Still loading" : "Loading"}
          aria-busy="true"
        >
          <span className="scene-loading__bar" />
        </div>
        {exceededBudget && onCancel ? (
          <div className="scene-loading__actions">
            <p className="scene-loading__slow">
              This is taking longer than expected.
            </p>
            <button type="button" onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
