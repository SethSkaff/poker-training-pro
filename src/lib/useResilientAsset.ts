import { useEffect, useReducer, useRef } from "react";
import {
  assetNotice,
  createAssetLoadState,
  reduceAssetLoadState,
} from "./assetFallback";

const DEFAULT_SLOW_AFTER_MS = 1_500;

export function useResilientAsset(
  key: string,
  label: string,
  slowAfterMs = DEFAULT_SLOW_AFTER_MS,
) {
  const [state, dispatch] = useReducer(
    reduceAssetLoadState,
    key,
    createAssetLoadState,
  );
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    dispatch({ type: "reset", key });
  }, [key]);

  useEffect(() => {
    if (state.key !== key || state.status !== "loading") return;
    const timer = window.setTimeout(() => {
      if (currentKey.current !== key) return;
      dispatch({ type: "reset", key });
      dispatch({ type: "slow", key });
    }, slowAfterMs);
    return () => window.clearTimeout(timer);
  }, [key, slowAfterMs, state.key, state.status]);

  return {
    key,
    status: state.key === key ? state.status : "loading",
    notice:
      state.key === key ? assetNotice(label, state.status) : null,
    onLoad: () => {
      if (currentKey.current !== key) return;
      // Reset first so even an immediate cache hit after a source change is
      // applied to the current asset rather than discarded as a stale event.
      dispatch({ type: "reset", key });
      dispatch({ type: "loaded", key });
    },
    onError: () => {
      if (currentKey.current !== key) return;
      dispatch({ type: "reset", key });
      dispatch({ type: "failed", key });
    },
  } as const;
}
