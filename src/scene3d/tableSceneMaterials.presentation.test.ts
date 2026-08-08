import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const scene = readFileSync(path.join(root, "tableScene.ts"), "utf8");

describe("table card and chip material presentation", () => {
  it("uses rough, non-emissive physical materials for playing cards", () => {
    expect(scene).toContain("new MeshStandardMaterial({\n      map: texture,");
    expect(scene).toContain("roughness: 0.94");
    expect(scene).toContain("roughness: 0.96");
    expect(scene).toContain("metalness: 0");
    expect(scene).not.toMatch(/cardFaceMaterial[\\s\\S]{0,300}emissive/);
  });

  it("keeps card texture colour in the display colour space and below paper white", () => {
    expect(scene).toContain('context.fillStyle = "#e9e3d7";');
    expect(scene).toContain('context.fillStyle = "#e5ded1";');
    expect(scene).toContain("texture.colorSpace = SRGBColorSpace;");
    expect(scene).not.toContain('context.fillStyle = "#fbf7ef";');
  });

  it("restores printed deck detail and gives ranks a readable, bold corner index", () => {
    expect(scene).toContain("A quiet paper");
    expect(scene).toContain("guilloche medallion");
    expect(scene).toContain("800 ${Math.round(canvas.height * 0.245)}px Georgia, serif");
    expect(scene).toContain("color: 0xf4efe4");
    expect(scene).toContain("color: 0xffffff");
  });

  it("uses rough clay chip bodies with the previous light center inlay", () => {
    expect(scene).toContain("chipMaterial: () => track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 }))");
    expect(scene).toContain("chipEdgeMaterial: () => track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0 }))");
    expect(scene).toContain("edge.copy(body).lerp(cream, 0.55);");
    expect(scene).toContain("faces.setColorAt(instance, inlay);");
  });
});
