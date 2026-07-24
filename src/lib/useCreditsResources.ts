import { useEffect, useState } from "react";
import {
  CREDITS_DOCUMENT_IDS,
  type BundledDocumentId,
  type DesktopAppInfo,
} from "./creditsData";

export interface CreditsResources {
  readonly appInfo?: DesktopAppInfo;
  readonly documents: Partial<Record<BundledDocumentId, string | undefined>>;
  readonly loading: boolean;
  /** True when the desktop bridge is unavailable (e.g. plain browser dev). */
  readonly desktopUnavailable: boolean;
}

/**
 * Loads runtime info and the bundled legal/notice documents through the narrow
 * preload bridge. Nothing is fetched over the network: each document is read
 * from the application's own bundled files in the main process. Failures are
 * contained so the screen always renders.
 */
export function useCreditsResources(): CreditsResources {
  const [appInfo, setAppInfo] = useState<DesktopAppInfo>();
  const [documents, setDocuments] = useState<
    Partial<Record<BundledDocumentId, string | undefined>>
  >({});
  const [loading, setLoading] = useState(true);
  const desktop = typeof window !== "undefined" ? window.desktop : undefined;

  useEffect(() => {
    let active = true;
    if (!desktop) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const info = await desktop.getAppInfo();
        if (active) setAppInfo(info);
      } catch {
        // Version info stays unavailable; the screen still renders.
      }
      const entries = await Promise.all(
        CREDITS_DOCUMENT_IDS.map(async (id) => {
          try {
            const result = await desktop.readBundledDocument(id);
            return [id, result.ok ? result.text : undefined] as const;
          } catch {
            return [id, undefined] as const;
          }
        }),
      );
      if (active) {
        setDocuments(Object.fromEntries(entries));
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [desktop]);

  return { appInfo, documents, loading, desktopUnavailable: !desktop };
}
