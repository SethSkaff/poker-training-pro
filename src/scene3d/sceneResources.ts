export interface DisposableSceneResource {
  dispose(): void;
}

export interface SceneResourceLedger {
  track<T extends DisposableSceneResource>(resource: T): T;
  dispose(): void;
  readonly counts: () => { resources: number; disposed: boolean };
}

/**
 * Renderer-local ownership for GPU resources. WebGL contexts cannot safely
 * share disposable three.js geometry or materials; tracking each allocation
 * also makes repeated mount/loss/recovery disposal idempotent and auditable.
 */
export function createSceneResourceLedger(): SceneResourceLedger {
  const resources = new Set<DisposableSceneResource>();
  let disposed = false;
  return {
    track<T extends DisposableSceneResource>(resource: T): T {
      if (disposed) {
        resource.dispose();
        return resource;
      }
      resources.add(resource);
      return resource;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const resource of resources) resource.dispose();
      resources.clear();
    },
    counts: () => ({ resources: resources.size, disposed }),
  };
}
