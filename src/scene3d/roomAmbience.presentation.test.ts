import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/scene3d/tableScene.ts"), "utf8");

describe("tournament-room ambience", () => {
  it("keeps occupied background tables as low-detail scenery", () => {
    expect(source).toContain("Background tournament tables have small seated silhouettes");
    expect(source).toContain("const backgroundSeats = [");
    expect(source).toContain("backgroundHead");
    expect(source).toContain("backgroundTorso");
  });

  it("uses broad warm house lights without changing the hero-table key", () => {
    expect(source).toContain("Broad house lights deliberately illuminate the room wings");
    expect(source).toContain("new PointLight(0xffc779, 3.3, 8.5, 2)");
    expect(source).toContain("new AmbientLight(0xffe8cc, 0.66)");
  });

  it("keeps the free-look camera inside a complete room shell", () => {
    expect(source).toContain("A fourth wall closes the player-facing side");
    expect(source).toContain("const nearWall = new Mesh(");
    expect(source).toContain("const ceiling = new Mesh(");
    expect(source).toContain("new PlaneGeometry(34, 34)");
    expect(source).toContain("[-8.7, 7.8], [8.7, 7.8], [0, 10.6]");
  });
});
