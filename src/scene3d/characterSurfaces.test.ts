import { describe, expect, it } from "vitest";
import { DEFAULT_FACIAL_STRUCTURE, FACE_PRESETS, describeOpponentCharacter } from "../lib/opponentAppearance";
import { foregroundPart } from "./foregroundLibrary";
import { fitFacialGeometry, hairMaterial } from "./characterSurfaces";
import { createSceneResourceLedger } from "./sceneResources";

describe("fitted character variation", () => {
  it("changes nose profile while preserving the skull and eye anchors", () => {
    const identity = describeOpponentCharacter("face-fit-review");
    for (const face of FACE_PRESETS) {
      const before = foregroundPart(`face/${face}`);
      const variants = ["straight", "broad", "button", "aquiline"] as const;
      const profiles = variants.map(nose => {
        const g = fitFacialGeometry(before.clone(), {...identity, facialStructure:{...DEFAULT_FACIAL_STRUCTURE,nose}}, true);
        const a=before.getAttribute("position"), b=g.getAttribute("position");
        let altered=0;
        for(let i=0;i<a.count;i++) {
          if(a.getY(i)>.060 || a.getZ(i)<0 || Math.abs(a.getX(i))>.03) {
            expect(b.getX(i)).toBe(a.getX(i));expect(b.getY(i)).toBe(a.getY(i));expect(b.getZ(i)).toBe(a.getZ(i));
          }
          if(a.getZ(i)!==b.getZ(i)) altered++;
        }
        if(nose!=="straight") expect(altered).toBeGreaterThan(5);
        g.computeBoundingBox();const depth=g.boundingBox!.max.z;g.dispose();return depth;
      });
      expect(profiles[2]).toBeLessThan(profiles[0]);expect(profiles[3]).toBeGreaterThan(profiles[0]);before.dispose();
    }
  });
  it("keeps fitted beard patches close to the selected jaw for every face family", () => {
    const identity=describeOpponentCharacter("beard-fit-review");
    for(const face of FACE_PRESETS) for(const jaw of ["balanced","square","tapered"] as const) {
      const character={...identity,face,facialStructure:{...DEFAULT_FACIAL_STRUCTURE,jaw}};
      const head=fitFacialGeometry(foregroundPart(`face/${face}`),character);
      const beard=fitFacialGeometry(foregroundPart(`beard/${face}/stubble`),character);
      const skin=head.getAttribute("position"),patch=beard.getAttribute("position");
      for(let i=0;i<patch.count;i++) {
        let distance=Infinity;
        for(let j=0;j<skin.count;j++) distance=Math.min(distance,Math.hypot(patch.getX(i)-skin.getX(j),patch.getY(i)-skin.getY(j),patch.getZ(i)-skin.getZ(j)));
        expect(distance).toBeLessThan(.002);
      }
      head.dispose();beard.dispose();
    }
  });
  it("uses cutout grain for stubble and bounded age-aware natural hair palettes", () => {
    const roster=Array.from({length:10000},(_,i)=>describeOpponentCharacter(`palette-${i}`));
    expect(roster.filter(c=>c.age==="young").every(c=>c.hairStyle!=="receding" && c.hairGradient<.6)).toBe(true);
    const darkSkin=roster.filter(c=>["#8d5a3a","#65402a"].includes(c.skinTone) && c.age==="adult");
    expect(darkSkin.filter(c=>c.hairGradient<.25).length/darkSkin.length).toBeGreaterThan(.95);
    expect(new Set(roster.map(c=>JSON.stringify(c.facialStructure))).size).toBeGreaterThan(200);
    const ledger=createSceneResourceLedger();const material=hairMaterial({...roster[0],facialHair:"stubble"},ledger,true);
    expect(material.alphaTest).toBe(.5);expect(material.transparent).toBe(false);expect(material.map).toBeTruthy();ledger.dispose();
  });
});
