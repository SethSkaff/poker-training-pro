export type AssetLoadStatus = "loading" | "slow" | "ready" | "failed";

export interface AssetLoadState {
  key: string;
  status: AssetLoadStatus;
}

export type AssetLoadEvent =
  | { type: "reset"; key: string }
  | { type: "loaded"; key: string }
  | { type: "failed"; key: string }
  | { type: "slow"; key: string };

export function createAssetLoadState(key: string): AssetLoadState {
  return { key, status: "loading" };
}

/**
 * Asset callbacks can arrive after a source has changed. Requiring an exact key
 * match keeps a late load/error from changing the state of the replacement.
 */
export function reduceAssetLoadState(
  state: AssetLoadState,
  event: AssetLoadEvent,
): AssetLoadState {
  if (event.type === "reset") {
    return event.key === state.key ? state : createAssetLoadState(event.key);
  }

  if (event.key !== state.key || state.status === "failed") {
    return state;
  }

  if (event.type === "loaded") {
    return state.status === "ready" ? state : { ...state, status: "ready" };
  }

  if (event.type === "failed") {
    return { ...state, status: "failed" };
  }

  if (event.type === "slow" && state.status === "loading") {
    return { ...state, status: "slow" };
  }

  return state;
}

export function assetNotice(
  label: string,
  status: AssetLoadStatus,
): string | null {
  if (status === "slow") {
    return `${label} is loading slowly. A lightweight local fallback is active.`;
  }
  if (status === "failed") {
    return `${label} could not be displayed. A lightweight local fallback is active.`;
  }
  return null;
}
