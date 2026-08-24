import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { DecorativeSceneErrorBoundary } from "./DecorativeSceneErrorBoundary";

describe("DecorativeSceneErrorBoundary", () => {
  it("removes only the decorative child and reports a renderer failure", () => {
    const child = createElement("canvas", { "aria-hidden": true });
    const onFailure = vi.fn();
    const boundary = new DecorativeSceneErrorBoundary({ children: child, onFailure });

    expect(boundary.render()).toBe(child);
    boundary.state = DecorativeSceneErrorBoundary.getDerivedStateFromError();
    boundary.componentDidCatch(new Error("chunk rejected"));

    expect(boundary.render()).toBeNull();
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
