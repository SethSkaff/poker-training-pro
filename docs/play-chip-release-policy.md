# Play-chip-only release boundary

Poker Training Pro is a local poker education game and tournament simulator.
Its chips are score units only. They cannot be bought, sold, deposited,
withdrawn, redeemed, transferred for value, or cashed out. The game offers no
prize with monetary value and no wagering path using money or anything of
value.

This is a product boundary, not merely store copy. Any future proposal for
payments, purchasable chips, prizes, accounts holding value, player-to-player
value transfer, or cash-out is outside the current product and requires a new
legal, platform, privacy, security, and age-rating review before implementation.

## Automated release evidence

Run:

```powershell
node scripts/audit-play-chip-boundary.mjs --self-test
node scripts/audit-play-chip-boundary.mjs
```

The deterministic audit:

- scans production `src/**` and `electron/**` code plus the renderer entry,
  Vite configuration, and package manifest while excluding tests and fixtures;
- scans the compiled `dist/**` renderer when present;
- scans `dist/**`, `electron/**`, and `package.json` inside the unpacked
  Windows `app.asar` when present;
- checks every direct and locked dependency name for payment and in-app
  purchase SDK indicators;
- fails on money movement, cash-out, payment, billing, wallet, real-money,
  cash-value, chip-sale, chip-purchase, chip-conversion, and known payment
  endpoint indicators;
- requires the visible phrases `Play chips only` and
  `No real-money wagering` in the active desktop `HomeView` and in every
  compiled/packaged renderer layer that exists. An unused component containing
  the copy does not pass.

Ordinary simulated-poker language and engine concepts—bet, call, raise, pot,
blind, all-in, chips, chip EV, and pot odds—are deliberately not violations.
The gate also recognizes the exact required negative disclosure instead of
mistaking it for a real-money feature.

The self-test proves the gate accepts simulated betting and the disclosure,
then rejects a chip sale, cash-out route, billing IPC, payment endpoint,
payment dependency, and missing disclosure.

## Release interpretation and remaining manual work

A passing report establishes that the scanned production surfaces contain no
recognized purchasing, payment, cash-out, or gambling-for-value capability and
that the play-chip disclosure survived compilation and packaging. It does not
prove the negative against every possible obfuscation or runtime behavior.
Interactive review must still confirm there is no money-related menu, link,
embedded page, operating-system purchase prompt, or value-bearing reward.

Store listing text, screenshots, age-rating answers, and simulated-gambling
disclosures are separate manual release evidence. They must describe the
education/simulation accurately and must not imply prizes, earnings, or improved
odds of winning money. A static pass does not approve those materials.
