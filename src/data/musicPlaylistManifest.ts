import type { PlaylistManifest } from "../lib/musicPlaylist";

export interface ProductionMusicCredit {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly sourceUrl: string;
  readonly isrc: string;
}

const INCOMPETECH_TRACK_PAGE =
  "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=";

export const productionMusicCredits: readonly ProductionMusicCredit[] = [
  { id: "ambiment", title: "Ambiment", author: "Kevin MacLeod", isrc: "USUAN1100630", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1100630` },
  { id: "space-jazz", title: "Space Jazz", author: "Kevin MacLeod", isrc: "USUAN2100030", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN2100030` },
  { id: "water-prelude", title: "Water Prelude", author: "Kevin MacLeod", isrc: "USUAN1100017", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1100017` },
  { id: "study-and-relax", title: "Study And Relax", author: "Kevin MacLeod", isrc: "USUAN1900030", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1900030` },
  { id: "poppers-and-prosecco", title: "Poppers and Prosecco", author: "Kevin MacLeod", isrc: "USUAN1700014", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1700014` },
  { id: "night-on-the-docks-sax", title: "Night on the Docks - Sax", author: "Kevin MacLeod", isrc: "USUAN1100137", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1100137` },
  { id: "george-street-shuffle", title: "George Street Shuffle", author: "Kevin MacLeod", isrc: "USUAN1300035", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1300035` },
  { id: "cool-vibes", title: "Cool Vibes", author: "Kevin MacLeod", isrc: "USUAN1100863", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1100863` },
  { id: "local-forecast-elevator", title: "Local Forecast - Elevator", author: "Kevin MacLeod", isrc: "USUAN1300012", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1300012` },
  { id: "dances-and-dames", title: "Dances and Dames", author: "Kevin MacLeod", isrc: "USUAN1100595", sourceUrl: `${INCOMPETECH_TRACK_PAGE}USUAN1100595` },
];

const durationById: Readonly<Record<string, number>> = {
  ambiment: 1372.87,
  "space-jazz": 369.51,
  "water-prelude": 324.92,
  "study-and-relax": 223.41,
  "poppers-and-prosecco": 193.78,
  "night-on-the-docks-sax": 174.06,
  "george-street-shuffle": 268.31,
  "cool-vibes": 218.39,
  "local-forecast-elevator": 189.21,
  "dances-and-dames": 146.84,
};

export const productionMusicManifest: PlaylistManifest = {
  version: 2,
  crossfadeSec: 4,
  tracks: productionMusicCredits.map((credit) => ({
    id: credit.id,
    title: credit.title,
    durationSec: durationById[credit.id],
    assetPath: `/audio/${credit.id}.ogg`,
  })),
};

export const productionMusicDurationSec = productionMusicManifest.tracks.reduce(
  (total, track) => total + track.durationSec,
  0,
);

export const musicPlaylistAvailable = productionMusicManifest.tracks.length > 0;

export const productionMusicLicense = {
  name: "Creative Commons Attribution 4.0 International",
  url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Music by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0.",
} as const;
