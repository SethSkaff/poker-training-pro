import { describe, expect, it } from "vitest";
import {
  assetNotice,
  createAssetLoadState,
  reduceAssetLoadState,
} from "./assetFallback";

describe("runtime asset fallback state", () => {
  it("uses a slow fallback until a late load recovers", () => {
    const initial = createAssetLoadState("/art.png");
    const slow = reduceAssetLoadState(initial, {
      type: "slow",
      key: "/art.png",
    });
    const recovered = reduceAssetLoadState(slow, {
      type: "loaded",
      key: "/art.png",
    });

    expect(slow.status).toBe("slow");
    expect(recovered.status).toBe("ready");
    expect(assetNotice("Background art", recovered.status)).toBeNull();
  });

  it("keeps failures terminal and visible", () => {
    const failed = reduceAssetLoadState(createAssetLoadState("/art.png"), {
      type: "failed",
      key: "/art.png",
    });

    expect(
      reduceAssetLoadState(failed, {
        type: "loaded",
        key: "/art.png",
      }),
    ).toBe(failed);
    expect(assetNotice("Background art", failed.status)).toContain(
      "could not be displayed",
    );
  });

  it("ignores stale callbacks after the asset changes", () => {
    const settings = reduceAssetLoadState(
      createAssetLoadState("/play.png"),
      { type: "reset", key: "/settings.png" },
    );

    expect(
      reduceAssetLoadState(settings, {
        type: "failed",
        key: "/play.png",
      }),
    ).toEqual(settings);
  });

  it("does not warn during ordinary loading or after success", () => {
    expect(assetNotice("Artwork", "loading")).toBeNull();
    expect(assetNotice("Artwork", "ready")).toBeNull();
  });
});
