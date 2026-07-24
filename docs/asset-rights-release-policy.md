# Asset rights release policy

This policy gates images, icons, and font binaries in Poker Training Pro. It is
an evidence and packaging control, not legal advice. A file being attractive,
user-supplied, AI-generated, already checked in, or technically valid does not
establish a right to redistribute it in a commercial desktop or mobile game.

The machine-readable authority is
`config/asset-rights-ledger.json`. Run:

```powershell
node scripts/validate-asset-rights.mjs
```

The validator is expected to exit non-zero while any rights or evidence item is
blocked. It also exits non-zero on hash/size/dimension drift, changed embedded
metadata, undeclared files in `public/` or `build/`, undeclared imported font
binaries, package/version/integrity drift, or unknown image/icon/font bytes in
an existing `dist/`.

## Current inventory and decision

The ledger covers 25 binary assets:

- 9 visual/package-identity files under `public/` and `build/`;
- 16 imported WOFF/WOFF2 font binaries from two exact Fontsource packages.

The current build copies seven public visual files and emits all sixteen font
binaries. `build/icon.ico` is the Windows executable/installer icon input.
`build/icon.png` is retained as a package-identity master candidate but is not
currently copied by the configured build file list.

Current release status is **blocked**:

- four PNGs have embedded `caBX` C2PA/JUMBF payloads whose inspected claim text
  names the OpenAI Media Service API, GPT Image 2.0, and the IPTC
  `trainedAlgorithmicMedia` digital source type;
- one background is identified by the task history and `TODOS.md` as
  user-supplied, but no creator, original master, or rights instrument is
  archived;
- four favicon/package-icon files are derived from the blocked generated mark;
- both font packages have strong package/master/OFL evidence, and their exact
  verified copyright/OFL texts are present in the distributable source path
  and included by the desktop package configuration.

The validator records a C2PA payload hash and stable claim markers. It does not
claim to have cryptographically validated the complete C2PA trust chain. More
importantly, even a valid Content Credential describes provenance; it is not by
itself a license, trademark clearance, likeness release, or warranty that a
commercial publisher may redistribute everything depicted.

## Status meanings

- `approved-commercial-redistribution`: retained evidence supports commercial
  redistribution for the stated use, with applicable conditions recorded.
- `user-supplied-unverified`: the user delivered the file, but identity,
  ownership, source, and granted rights remain unproven.
- `generated-provenance-unverified`: metadata signals generative creation, but
  the request/receipt, applicable terms version, and third-party IP review are
  not archived.
- `derived-blocked`: the derivation may be technically demonstrated, but the
  parent asset or its rights evidence is blocked.

No generated visual is approved merely because it contains a C2PA claim. No
derived icon can be approved while its parent mark is blocked.

## Required evidence for visual assets

Before changing a visual to `approved-commercial-redistribution`, archive all
of the following in a publisher-controlled release evidence location:

1. Creator identity and original source. For a generated file, retain the
   original generation request, exact downloaded output, account/receipt or job
   context, tool/model identity, and generation date.
2. A designated unmodified master with SHA-256 and an immutable receipt or
   export record. If the runtime asset is transformed, retain a reproducible
   script/recipe, tool version, inputs, and output hashes.
3. The actual rights instrument and its version/date. This may be a signed
   creator assignment/license or archived service terms that demonstrably
   apply to the output and publisher.
4. Written scope covering commercial Windows, iPhone, and iPad redistribution,
   adaptation, store screenshots/marketing, and continued distribution of
   already released versions.
5. Human review of third-party characters, brands, logos, artwork, playing-card
   designs, likenesses, and other protectable elements. The product mark also
   needs trademark/confusing-similarity review.
6. A named publisher approver and approval date. Do not substitute an agent's
   inference for publisher approval.

For `public/start-menu-reference.png`, delivery in the conversation is evidence
of custody only. The publisher must provide the creator/source, original
supplied master, any transformation record, and a signed ownership statement or
license granting the required commercial rights.

For the four generated PNGs, the checked-in binary and C2PA signal are useful
but incomplete. The publisher must archive the generation evidence and
applicable service terms, then complete an IP/trademark/likeness review.

For the favicon and package-icon files, first clear
`public/poker-training-pro-mark.png`, then retain the exact resize/ICO recipe and
tool version. Local inspection found:

- `build/icon.png` is pixel-identical to a 512x512 RGBA Lanczos resize of the
  mark;
- `public/favicon.png` is pixel-identical to a 64x64 RGBA Lanczos resize of the
  mark;
- every encoded frame in `public/favicon.ico` is byte-identical to the
  corresponding frame in `build/icon.ico`.

These technical relationships do not cure the parent's rights blocker.

## Font evidence and obligations

The application imports exact version `5.3.0` of
`@fontsource/inter` and `@fontsource/barlow-condensed`. The ledger pins:

- the npm package version and lockfile integrity;
- every imported WOFF and WOFF2 binary by path, size, and SHA-256;
- the installed package manifest and metadata;
- the exact bundled `LICENSE` file by size and SHA-256;
- official Fontsource source directories and Google Fonts OFL texts.

The installed package metadata declares `OFL-1.1`. The bundled license permits
use, embedding, bundling, and redistribution with software subject to its
conditions, including retaining the copyright notice and license with each
copy. Exact hash-matching copies are checked in at:

- `licenses/fonts/inter-OFL-1.1.txt`
- `licenses/fonts/barlow-condensed-OFL-1.1.txt`

The desktop package configuration includes `licenses/**/*`; the final desktop
and mobile artifact audits must still verify these texts are present. If font
files are modified, renamed, subset differently, or replaced, re-review OFL
reserved-name and modified-version obligations and refresh all hashes.

## Change procedure

For every added or replaced visual/font:

1. Add the file and its complete evidence record to the ledger in sorted order.
2. Record exact byte length, SHA-256, dimensions/format, and relevant embedded
   metadata. Treat opaque or unverified metadata conservatively.
3. Add source, master, license, attribution/notice, and publisher approval
   evidence. Unknown fields block release; never use `UNKNOWN` to mean allowed.
4. Declare derivation parents and ensure every parent is independently cleared.
5. Build and run the validator. Review the `dist/` inventory as well as source
   inventory.
6. Have the publisher or qualified reviewer sign off on the evidence. The
   validator checks consistency and completeness; it cannot make a legal
   judgment.

Deleting an unused asset from runtime/package inventory is an acceptable way to
remove its blocker, provided no binary, generated build, store screenshot, or
marketing material still ships it.
