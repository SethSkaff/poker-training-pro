import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/scene3d/tableScene.ts"), "utf8");

describe("tournament-room ambience", () => {
  it("keeps the gameplay room focused on a single poker table", () => {
    expect(source).not.toContain("Background tournament tables have small seated silhouettes");
    expect(source).not.toContain("const backgroundSeats = [");
    expect(source).not.toContain("backgroundHead");
    expect(source).not.toContain("backgroundTorso");
  });

  it("uses a compact warm light envelope without changing the hero-table key", () => {
    expect(source).toContain("A compact four-light room envelope");
    expect(source).toContain("new PointLight(0xffcf9a, 8.0, 16, 2)");
    expect(source).toContain("new AmbientLight(0xffe8cc, 0.66)");
  });

  it("keeps the camera inside a compact complete room shell with a visible exit", () => {
    expect(source).toContain("const roomSize = 6.4");
    expect(source).toContain("const nearWall = new Mesh(");
    expect(source).toContain("const ceiling = new Mesh(");
    expect(source).toContain("new PlaneGeometry(roomSize, roomSize)");
    expect(source).toContain('door.name = "card-room-exit-door"');
    expect(source).toContain('exitSign.name = "card-room-exit-sign"');
  });
});
