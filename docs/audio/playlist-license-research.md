# Poker Training Pro audio playlist and license research

Verified: 2026-07-23  
Scope: paid Windows/macOS desktop application
Status: research complete; **ten Incompetech tracks acquired and accepted**

## Decision

The safest short list comes from two composer-owned catalogs:

- **Silverman Sound Studios (Shane Ivers):** its official catalog expressly lists commercial products, video games, and apps. Its paid Pro License grants project-specific worldwide, perpetual distribution and sale rights without attribution.
- **Incompetech (Kevin MacLeod):** every shortlisted track has an official CC BY 4.0 declaration. The official FAQ specifically describes a game credits screen as appropriate attribution, permits extensive edits, and offers a paid worldwide project license when attribution is not desired.

Ten Incompetech tracks are now accepted in [`config/audio-candidate-manifest.json`](../../config/audio-candidate-manifest.json). Their exact local masters, SHA-256 checksums, official source pages, bundled CC BY 4.0 legal code, encode report, and in-app attribution are archived. The other researched candidates remain conditional and are not bundled.

The recommended route is to audition first, then buy and archive proprietary project licenses for the final 8–12 tracks. Free CC BY 4.0 use is commercially possible, but its prohibition on effective technological measures still needs legal review before placing CC BY masters in a signed desktop package.

This document is a release-engineering assessment, not legal advice.

## Candidate playlist

### Calm focus and table rotation

| Track | Composer | Role | Why it is shortlisted |
|---|---|---|---|
| [Opening Move](https://www.silvermansound.com/free-music/opening-move) | Shane Ivers | Main table | Muted-trumpet jazz quartet, 80 BPM, restrained and casino-adjacent without being a jingle. |
| [Rendezvous](https://www.silvermansound.com/free-music/rendezvous) | Shane Ivers | Practice/table | Relaxed acoustic French jazz, 93 BPM. |
| [Streetlight Serenade](https://www.silvermansound.com/free-music/streetlight-serenade) | Shane Ivers | Late table/noir | Brushed drums, clarinet, piano, bass, and guitar. |
| [Tape Star](https://www.silvermansound.com/free-music/tape-star) | Shane Ivers | Practice | Warm looping lo-fi bed; stems are offered under Pro. |
| [Chasing Tales](https://www.silvermansound.com/free-music/chasing-tales) | Shane Ivers | Long sessions | Seven-minute, 77 BPM lo-fi cue with enough duration to reduce repetition. |
| [Spacedman](https://www.silvermansound.com/free-music/spacedman) | Shane Ivers | Rational/practice | Clean-looping electronic chill; audition its chiptune color against the casino identity. |
| [Study And Relax](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1900030) | Kevin MacLeod | Practice | Calm 72 BPM jazz with saxophones, piano, bass, and percussion. |
| [Poppers and Prosecco](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1700014) | Kevin MacLeod | Menu/light table | Bright but relaxed 70 BPM jazz quartet. |
| [Space Jazz](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN2100030) | Kevin MacLeod | Rational/long table | Six-minute relaxed synth-jazz written for a game. |
| [Night on the Docks - Sax](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100137) | Kevin MacLeod | Late table/noir | Sparse tenor sax and electric piano. |
| [Jazz Brunch](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1700074) | Kevin MacLeod | Light table/menu | Officially tagged bright, grooving, and relaxed. |
| [Ambiment](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100630) | Kevin MacLeod | Extended practice | A 22-minute piano/synth texture with an excellent repetition profile; desktop package size must be measured. |
| [Water Prelude](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100017) | Kevin MacLeod | Reflective practice | Five-minute smooth background cue. |

### Restrained tournament intensity and progression

| Track | Composer | Role | Guardrail |
|---|---|---|---|
| [Dark Flashes](https://www.silvermansound.com/free-music/dark-flashes) | Shane Ivers | Bubble/final table | Methodical 95 BPM lo-fi jazz; reject if its melody interferes with decision-making. |
| [Save Us Now](https://www.silvermansound.com/free-music/save-us-now) | Shane Ivers | Final-table pressure | Quietly epic electronic energy without the described large drops of rejected trance/trap tracks. |
| [Deadly Roulette](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1600033) | Kevin MacLeod | Dark table rotation | Officially tagged dark, grooving, relaxed; title alone is not a selection reason. |
| [Ascension](https://www.silvermansound.com/free-music/ascension) | Shane Ivers | Qualification/results | Calm ambient lift for transitions, not continuous table play. |
| [Mystery Unsolved](https://www.silvermansound.com/free-music/mystery-unsolved) | Shane Ivers | Training puzzle reveal | Brief thematic cue; likely too foregrounded for continuous rotation. |
| [Speakeasy](https://www.silvermansound.com/free-music/speakeasy) | Shane Ivers | Menu/light table | Compact period swing; audition for excess comedy. |

## License basis

### Silverman Sound

The [official license comparison](https://www.silvermansound.com/licenses) says both its free and paid licenses cover commercial use, video games, and apps, and permit editing, cutting, pitch shifting, slowing, and speeding. It prohibits standalone audio redistribution, sublicensing, ownership claims, and registering the music with Content ID.

The [official Pro License agreement](https://www.silvermansound.com/pro-license) grants the named licensee a non-exclusive, worldwide right to incorporate the named track in a named project and to distribute, sell, market, exhibit, and otherwise exploit that project forever in any present or future medium. A Pro license is one project; the [official FAQ](https://www.silvermansound.com/faqs) says one complete game is a project and says games/apps are covered.

Free use is CC BY 4.0. The composer’s requested game credit is `Music by Shane Ivers (silvermansound.com)`. The official FAQ warns that YouTube credits should be in the description to avoid Content ID claims and offers personal claim support. That issue primarily affects marketing videos and streams, but all evidence still needs to be archived.

### Incompetech

The [official Incompetech FAQ](https://incompetech.com/music/royalty-free/faq.html) says games commonly place the required credit on a Credits screen and supplies the required title/author/site/license format. It also explicitly permits singing over, chopping, splicing, compressing, lengthening, and adding instruments. Substantive new material should be identified; ordinary cut-and-splice edits need not be called out.

The [official license generator](https://incompetech.com/music/royalty-free/licenses/) offers a Standard License for projects where attribution is unwanted. The site’s [copyright explanation](https://incompetech.com/music/royalty-free/about_copyright.html) reproduces the project-license language: the production can be distributed, sold, marketed, exhibited, and otherwise exploited worldwide, forever, in current and future media.

Incompetech’s [current Content ID page](https://incompetech.com/music/royalty-free/youtube-contentid.html) says the catalog has been pre-registered to prevent third parties from making false claims. A properly credited dispute should be released within about 72 hours. Preserve the track ISRC in every rights record.

### Creative Commons

The [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/) permits sharing and adaptation for commercial purposes. The [legal code](https://creativecommons.org/licenses/by/4.0/legalcode.en) requires creator identification, a license notice/link, a source link where practical, and indication of modifications. It also prohibits adding effective technological measures that restrict recipients, so the signed-package route remains conditional pending legal review.

## Rejected sources and tracks

- **YouTube Audio Library / Creator Music:** YouTube’s [official Audio Library help](https://support.google.com/youtube/answer/3376882) frames the assets as music for videos and explicitly says YouTube cannot give guidance about issues off-platform. [Creator Music usage terms](https://support.google.com/youtube/answer/11611019) say its licenses are not transferable to other platforms. This is not a paid-game master license.
- **Pixabay launch sourcing:** its [official terms](https://pixabay.com/service/terms/) can allow incorporation into a larger app/game, but disclaim that necessary third-party permissions were obtained. Its [official FAQ](https://pixabay.com/service/faq/) warns that contributors or distributors may register tracks with Content ID. Direct composer licensing is materially cleaner.
- **FreePD:** the [official site](https://freepd.com/) says it permanently closed in 2025. A new release cannot reliably preserve original track pages and dedication/download evidence.
- **Free Music Archive as a blanket source:** the portal contains mixed licenses, including noncommercial works. Only reconsider an individual track if the composer’s own official page independently grants the exact needed rights.
- **Streaming URLs or stream-rips:** consumer playback is not a synchronization, reproduction, or distribution license.
- **CC BY-NC / personal use:** incompatible with a paid app. **CC BY-ND:** unsafe for synchronization/editing. **ShareAlike:** requires a separate compatibility review and is not needed when cleaner alternatives exist.
- **High-impact Silverman tracks:** Mercury, Nightchaser, Seismic, and WOAH were rejected from metadata before download because their official pages describe big drops, pounding trance, aggressive trap/dubstep, or 175 BPM jungle/vocal-sample energy.

## Required written confirmation

Before spending money or downloading production masters, ask the chosen licensor to confirm:

1. One named `Poker Training Pro` project license covers the Windows and macOS desktop apps, updates, and regional distribution.
2. Embedding the master in signed/encrypted packages is permitted and is not “standalone” distribution.
3. Store previews, trailers, livestreams, and gameplay marketing are covered, or identify which need separate licenses.
4. If using a Patreon/catalog-wide offer, every personalized certificate remains perpetual after cancellation.
5. The supplied master is human-composed/recorded, contains no uncleared samples, and the licensor controls both composition and sound-recording rights.

## Release acceptance checklist

No candidate may move from `conditional` to `accepted` until all boxes are satisfied:

- [ ] Blind-audition the exact master against card, chip, dealer, UI, and voice/tutorial sounds.
- [ ] Confirm instrumental-only content; reject lyrics, vocal samples, casino jingles, sharp stingers, and distracting drops.
- [ ] Record title, composer, ISRC, source URL, original filename, download date/time, and SHA-256.
- [ ] Save a PDF or screenshot of the official track page and license terms as they appeared on acquisition day.
- [ ] Buy/archive a personalized project license, invoice, receipt, and written platform-scope confirmation; or obtain legal sign-off for the CC BY signed-desktop-package route.
- [ ] Add a visible in-game Credits page if any CC BY track remains.
- [ ] Include title, creator, source, license link, and modification notice in credits.
- [ ] Confirm the project does not register original or edited tracks in Content ID, Rights Manager, DSPs, or music stores.
- [ ] Normalize production masters to the game’s loudness target without clipping; preserve the original master separately.
- [ ] Create tested sample-accurate loop points or use intentional crossfades; verify no click/pop on Windows and macOS.
- [ ] Encode desktop variants within the project’s audio-size budget; measure install-size impact.
- [ ] Verify offline playback, suspend/resume, headphone disconnect, audio interruption, mute, music-volume, and reduced-power behavior.
- [ ] Run a 60-minute shuffle soak with no immediate repeats and no state-dependent bias that leaks opponent information.
- [ ] Confirm packaged audio is not exposed through an in-app export/download feature.
- [ ] Run a test marketing upload privately/unlisted where applicable and archive any Content ID result or clearance.
- [ ] Have release counsel or the publisher sign the final rights ledger.

## Suggested first audition

Start with these eight because they cover the core moods without becoming a stylistic grab bag:

1. Opening Move
2. Study And Relax
3. Rendezvous
4. Streetlight Serenade
5. Chasing Tales
6. Space Jazz
7. Dark Flashes
8. Save Us Now

If the project wants a bigger rotation after blind testing, add Tape Star, Night on the Docks - Sax, Jazz Brunch, Water Prelude, Ascension, and one of Ambiment or Spacedman. Avoid filling the playlist merely to make it large; long-session fatigue and coherent mastering matter more than track count.
