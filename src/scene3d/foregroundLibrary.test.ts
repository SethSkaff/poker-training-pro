import { describe, expect, it } from 'vitest';
import { FACE_PRESETS, MALE_HAIR_STYLES, FEMALE_HAIR_STYLES, OUTFITS, describeOpponentCharacter } from '../lib/opponentAppearance';
import { foregroundPart } from './foregroundLibrary';
import { decodePackedGeometry } from './tableGeometryLibrary';

describe('authored foreground compatibility', () => {
  it('decodes signed deltas without unsigned index wrap or position drift', () => {
    const geometry = decodePackedGeometry({position: [0,0,0,100000,0,0,-100000,100000,0],positionScale:100000,deltaEncoded:true,index:[0,1,1],indexBits:16});
    expect(Array.from(geometry.getAttribute('position').array)).toEqual([0,0,0,1,0,0,0,1,0]);
    expect(Array.from(geometry.getIndex()!.array)).toEqual([0,1,2]);
    expect(geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1);
    geometry.dispose();
  });
  it('has geometry for every selectable face, hair and outfit', () => {
    const names = [...FACE_PRESETS.map(n=>`face/${n}`),...[...MALE_HAIR_STYLES,...FEMALE_HAIR_STYLES].filter(n=>n!=='bald').map(n=>`hair/${n}`),...OUTFITS.flatMap(n=>[`top/${n.name}`,`detail/${n.name}`])];
    for (const name of names) {
      const g=foregroundPart(name);g.computeBoundingBox();
      expect(g.getIndex()!.count).toBeGreaterThan(0);
      expect(g.boundingBox!.isEmpty()).toBe(false);
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      g.dispose();
    }
  });
  it('keeps cosmetic distribution and compatibility independent of poker state', () => {
    const roster=Array.from({length:10000},(_,i)=>describeOpponentCharacter(`asset-roster-${i}`));
    const males=roster.filter(c=>c.gender==='male').length/roster.length;
    const moles=roster.filter(c=>c.mole!=null).length/roster.length;
    expect(males).toBeGreaterThan(.72);expect(males).toBeLessThan(.78);
    expect(moles).toBeGreaterThan(.035);expect(moles).toBeLessThan(.065);
    expect(roster.filter(c=>c.gender==='female').every(c=>c.facialHair==='none')).toBe(true);
    expect(new Set(roster.map(c=>[c.face,c.hairStyle,c.hairColor,c.body,c.skinTone,c.eyeColor,c.outfit.name].join('|'))).size).toBeGreaterThan(1000);
  });
});
