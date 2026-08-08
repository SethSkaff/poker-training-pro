/**
 * Audition/rights catalogue for the intended long-session poker soundtrack.
 *
 * This is deliberately separate from `productionMusicManifest`: these are
 * candidates, not shipped masters. The four passes make a 5h+ programme after
 * approved copies are added, while each pass contains the same sixteen
 * distinct cues in a different order so a track never immediately repeats.
 */
export interface MusicCatalogueCandidate {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly durationSec: number;
  readonly sourceUrl: string;
  readonly license: "CC BY 4.0";
  readonly credit: string;
}

export const musicCatalogueCandidates: readonly MusicCatalogueCandidate[] = [
  { id: "opening-move", title: "Opening Move", artist: "Shane Ivers", durationSec: 148, sourceUrl: "https://www.silvermansound.com/free-music/opening-move", license: "CC BY 4.0", credit: "Music: Opening Move by Shane Ivers — silvermansound.com" },
  { id: "speakeasy", title: "Speakeasy", artist: "Shane Ivers", durationSec: 88, sourceUrl: "https://www.silvermansound.com/free-music/speakeasy", license: "CC BY 4.0", credit: "Music: Speakeasy by Shane Ivers — silvermansound.com" },
  { id: "rendezvous", title: "Rendezvous", artist: "Shane Ivers", durationSec: 129, sourceUrl: "https://www.silvermansound.com/free-music/rendezvous", license: "CC BY 4.0", credit: "Music: Rendezvous by Shane Ivers — silvermansound.com" },
  { id: "streetlight-serenade", title: "Streetlight Serenade", artist: "Shane Ivers", durationSec: 174, sourceUrl: "https://www.silvermansound.com/free-music/streetlight-serenade", license: "CC BY 4.0", credit: "Music: Streetlight Serenade by Shane Ivers — silvermansound.com" },
  { id: "chasing-tales", title: "Chasing Tales", artist: "Shane Ivers", durationSec: 430, sourceUrl: "https://www.silvermansound.com/free-music/chasing-tales", license: "CC BY 4.0", credit: "Music: Chasing Tales by Shane Ivers — silvermansound.com" },
  { id: "spacedman", title: "Spacedman", artist: "Shane Ivers", durationSec: 211, sourceUrl: "https://www.silvermansound.com/free-music/spacedman", license: "CC BY 4.0", credit: "Music: Spacedman by Shane Ivers — silvermansound.com" },
  { id: "dark-flashes", title: "Dark Flashes", artist: "Shane Ivers", durationSec: 217, sourceUrl: "https://www.silvermansound.com/free-music/dark-flashes", license: "CC BY 4.0", credit: "Music: Dark Flashes by Shane Ivers — silvermansound.com" },
  { id: "ascension", title: "Ascension", artist: "Shane Ivers", durationSec: 226, sourceUrl: "https://www.silvermansound.com/free-music/ascension", license: "CC BY 4.0", credit: "Music: Ascension by Shane Ivers — silvermansound.com" },
  { id: "mystery-unsolved", title: "Mystery Unsolved", artist: "Shane Ivers", durationSec: 169, sourceUrl: "https://www.silvermansound.com/free-music/mystery-unsolved", license: "CC BY 4.0", credit: "Music: Mystery Unsolved by Shane Ivers — silvermansound.com" },
  { id: "save-us-now", title: "Save Us Now", artist: "Shane Ivers", durationSec: 172, sourceUrl: "https://www.silvermansound.com/free-music/save-us-now", license: "CC BY 4.0", credit: "Music: Save Us Now by Shane Ivers — silvermansound.com" },
  { id: "study-and-relax", title: "Study And Relax", artist: "Kevin MacLeod", durationSec: 223, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100685", license: "CC BY 4.0", credit: "Study And Relax — Kevin MacLeod (incompetech.com), CC BY 4.0" },
  { id: "poppers-and-prosecco", title: "Poppers and Prosecco", artist: "Kevin MacLeod", durationSec: 194, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1700014", license: "CC BY 4.0", credit: "Poppers and Prosecco — Kevin MacLeod (incompetech.com), CC BY 4.0" },
  { id: "space-jazz", title: "Space Jazz", artist: "Kevin MacLeod", durationSec: 370, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN2100030", license: "CC BY 4.0", credit: "Space Jazz — Kevin MacLeod (incompetech.com), CC BY 4.0" },
  { id: "night-on-the-docks-sax", title: "Night on the Docks - Sax", artist: "Kevin MacLeod", durationSec: 174, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100137", license: "CC BY 4.0", credit: "Night on the Docks - Sax — Kevin MacLeod (incompetech.com), CC BY 4.0" },
  { id: "ambiment", title: "Ambiment", artist: "Kevin MacLeod", durationSec: 1373, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100630", license: "CC BY 4.0", credit: "Ambiment — Kevin MacLeod (incompetech.com), CC BY 4.0" },
  { id: "water-prelude", title: "Water Prelude", artist: "Kevin MacLeod", durationSec: 324, sourceUrl: "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100017", license: "CC BY 4.0", credit: "Water Prelude — Kevin MacLeod (incompetech.com), CC BY 4.0" },
];

const base = musicCatalogueCandidates.map((track) => track.id);
export const fiveHourRotation: readonly (readonly string[])[] = [
  base,
  [...base.slice(5), ...base.slice(0, 5)],
  [...base].reverse(),
  [...base.slice(10), ...base.slice(0, 10)],
] as const;

export const fiveHourRotationDurationSec = fiveHourRotation.reduce<number>(
  (total, pass) =>
    total +
    pass.reduce<number>(
      (sum, id) =>
        sum +
        (musicCatalogueCandidates.find((track) => track.id === id)?.durationSec ??
          0),
      0,
    ),
  0,
);
