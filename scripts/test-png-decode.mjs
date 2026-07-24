import assert from "node:assert/strict";
import {
  decodePng,
  encodeMinimalPngForTests,
  unfilterScanlines,
} from "./release/png-decode-lib.mjs";

// --- unfilterScanlines: hand-computed filter-type coverage ---

// Filter type 0 (None): reconstructed bytes equal the filtered bytes.
assert.deepEqual(
  Array.from(unfilterScanlines(Uint8Array.of(0, 10, 20, 30), 1, 1, 3)),
  [10, 20, 30],
);

// Filter type 1 (Sub): Recon(x) = Filt(x) + Recon(x - bpp), 0 for x < bpp.
// Two 1-channel pixels per row so the second pixel exercises the Sub term.
assert.deepEqual(
  Array.from(unfilterScanlines(Uint8Array.of(1, 5, 5), 2, 1, 1)),
  [5, 10],
);

// Filter type 2 (Up): Recon(x) = Filt(x) + Recon_prior(x).
// Row 0 (filter None) = [10]; row 1 (filter Up) adds 5 -> [15].
assert.deepEqual(
  Array.from(unfilterScanlines(Uint8Array.of(0, 10, 2, 5), 1, 2, 1)),
  [10, 15],
);

// Filter type 3 (Average): Recon(x) = Filt(x) + floor((a + b) / 2).
// Row 0 = [10, 20] (filter None). Row 1 filter Average on a 2-pixel row:
// x=0: a=0 (no left neighbor), b=10 (prior row) -> filt(4) + floor(10/2)=5 -> 9
// x=1: a=9 (just-reconstructed left neighbor), b=20 (prior row) -> filt(6) + floor((9+20)/2)=14 -> 20
assert.deepEqual(
  Array.from(unfilterScanlines(Uint8Array.of(0, 10, 20, 3, 4, 6), 2, 2, 1)),
  [10, 20, 9, 20],
);

// Filter type 4 (Paeth): Recon(x) = Filt(x) + PaethPredictor(a, b, c).
// Row 0 = [10, 20] (filter None). Row 1 filter Paeth on a 2-pixel row:
// x=0: a=0, b=10, c=0 -> Paeth picks b(10) -> filt(0) + 10 = 10
// x=1: a=10 (left), b=20 (prior), c=10 (prior-left) -> p=10+20-10=20 -> pa=10,pb=0,pc=10 -> picks b(20)
//      -> filt(0) + 20 = 20
assert.deepEqual(
  Array.from(unfilterScanlines(Uint8Array.of(0, 10, 20, 4, 0, 0), 2, 2, 1)),
  [10, 20, 10, 20],
);

for (const invalid of [
  () => unfilterScanlines(Uint8Array.of(0, 1, 2), 0, 1, 1),
  () => unfilterScanlines(Uint8Array.of(0, 1, 2), 1, 0, 1),
  () => unfilterScanlines(Uint8Array.of(0, 1, 2), 1, 1, 5),
]) {
  assert.throws(invalid, /invalid/i);
}
assert.throws(
  () => unfilterScanlines(Uint8Array.of(0, 1), 2, 1, 1), // wrong length
  /expected/i,
);
assert.throws(
  () => unfilterScanlines(Uint8Array.of(9, 1, 2, 3), 1, 1, 3), // unknown filter type
  /unsupported/i,
);

// --- decodePng: full round trip via the test-only minimal encoder ---

const width = 4;
const height = 3;
const rgba = new Uint8Array(width * height * 4);
for (let index = 0; index < width * height; index += 1) {
  rgba[index * 4] = (index * 17) % 256;
  rgba[index * 4 + 1] = (index * 53) % 256;
  rgba[index * 4 + 2] = (index * 97) % 256;
  rgba[index * 4 + 3] = 255;
}
const encoded = encodeMinimalPngForTests(width, height, rgba);
const decoded = decodePng(encoded);
assert.equal(decoded.width, width);
assert.equal(decoded.height, height);
assert.deepEqual(Array.from(decoded.pixels), Array.from(rgba));

// A flat single-color image, a common real-world case (solid background).
const flatWidth = 3;
const flatHeight = 3;
const flatRgba = new Uint8Array(flatWidth * flatHeight * 4);
for (let index = 0; index < flatWidth * flatHeight; index += 1) {
  flatRgba[index * 4] = 12;
  flatRgba[index * 4 + 1] = 200;
  flatRgba[index * 4 + 2] = 44;
  flatRgba[index * 4 + 3] = 255;
}
const flatDecoded = decodePng(encodeMinimalPngForTests(flatWidth, flatHeight, flatRgba));
assert.deepEqual(Array.from(flatDecoded.pixels), Array.from(flatRgba));

// --- decodePng: negative cases ---
assert.throws(() => decodePng(Uint8Array.of(1, 2, 3, 4)), /signature/i);
assert.throws(
  () => decodePng(Uint8Array.from([...Buffer.from("not a png but 8+ bytes long")])),
  /signature/i,
);

console.log(
  "PNG decode self-tests passed: all five scanline filter types, encode/decode round trip (gradient and flat images), and malformed-input rejection.",
);
