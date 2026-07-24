/**
 * A minimal, dependency-free PNG reader (and a matching test-only encoder)
 * used by the rendered flash/luminance analysis. `Page.captureScreenshot`
 * returns PNG bytes over CDP; decoding them into raw pixels normally means
 * adding an image library. The project's "no new dependencies" constraint
 * means this instead hand-implements just enough of the PNG spec (RFC 2083)
 * to read the non-interlaced, 8-bit-depth, truecolor/truecolor-with-alpha
 * images Chromium's screenshot encoder produces, using only `node:zlib` for
 * the DEFLATE/zlib stream inside the IDAT chunk(s).
 *
 * Deliberately unsupported (throws a clear error instead of guessing):
 * palette (colorType 3) and grayscale-only images, bit depths other than 8,
 * and Adam7 interlacing. Chromium's `Page.captureScreenshot` PNG output does
 * not use any of these, so the restriction does not affect the capture
 * script this module supports.
 */
import { inflateSync, deflateSync } from "node:zlib";

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

/**
 * Decodes a PNG byte buffer into raw RGBA pixels.
 * @param {Uint8Array|Buffer} buffer
 * @returns {{ width: number, height: number, pixels: Uint8Array }} pixels is
 *   a width*height*4 RGBA byte array (alpha is 255 for opaque source images).
 */
export function decodePng(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : Uint8Array.from(buffer);
  if (bytes.length < 8 || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new TypeError("Input is not a PNG byte stream (bad signature).");
  }

  let offset = 8;
  let ihdr;
  const idatParts = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) {
      throw new TypeError("Truncated PNG chunk header.");
    }
    const length = readUint32BE(bytes, offset);
    const type = asciiChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length < 0 || dataEnd + 4 > bytes.length) {
      throw new TypeError(`Truncated PNG chunk data for "${type}".`);
    }
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      ihdr = parseIhdr(data);
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4; // skip the trailing CRC32
  }

  if (!ihdr) throw new TypeError("PNG is missing an IHDR chunk.");
  if (idatParts.length === 0) throw new TypeError("PNG has no IDAT data.");
  if (ihdr.bitDepth !== 8) {
    throw new TypeError(`Unsupported PNG bit depth ${ihdr.bitDepth}; only 8-bit is supported.`);
  }
  if (ihdr.interlaceMethod !== 0) {
    throw new TypeError("Interlaced PNGs are not supported.");
  }
  const channels = channelsForColorType(ihdr.colorType);

  const idatConcatenated = concatBytes(idatParts);
  const inflated = inflateSync(Buffer.from(idatConcatenated));
  const raw = unfilterScanlines(inflated, ihdr.width, ihdr.height, channels);
  const pixels = expandToRgba(raw, ihdr.width, ihdr.height, channels);
  return { width: ihdr.width, height: ihdr.height, pixels };
}

/**
 * Reverses PNG per-scanline filtering (RFC 2083 section 6). Exported
 * separately so filter reconstruction can be unit-tested against
 * hand-computed byte sequences without needing a real PNG container.
 * @param {Uint8Array} filtered one filter-type byte followed by
 *   width*bytesPerPixel data bytes, repeated for each of `height` rows.
 */
export function unfilterScanlines(filtered, width, height, bytesPerPixel) {
  if (!Number.isInteger(width) || width <= 0 || width > 20_000) {
    throw new TypeError("Invalid PNG width.");
  }
  if (!Number.isInteger(height) || height <= 0 || height > 20_000) {
    throw new TypeError("Invalid PNG height.");
  }
  if (!Number.isInteger(bytesPerPixel) || bytesPerPixel < 1 || bytesPerPixel > 4) {
    throw new TypeError("Invalid PNG bytes-per-pixel.");
  }
  const rowBytes = width * bytesPerPixel;
  const expectedLength = (rowBytes + 1) * height;
  if (filtered.length !== expectedLength) {
    throw new TypeError(
      `PNG scanline data has length ${filtered.length}, expected ${expectedLength}.`,
    );
  }
  const output = new Uint8Array(rowBytes * height);
  let priorRowStart = -1;
  for (let row = 0; row < height; row += 1) {
    const srcRowStart = row * (rowBytes + 1);
    const filterType = filtered[srcRowStart];
    const dstRowStart = row * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const filt = filtered[srcRowStart + 1 + x];
      const a = x >= bytesPerPixel ? output[dstRowStart + x - bytesPerPixel] : 0;
      const b = priorRowStart >= 0 ? output[priorRowStart + x] : 0;
      const c =
        priorRowStart >= 0 && x >= bytesPerPixel
          ? output[priorRowStart + x - bytesPerPixel]
          : 0;
      let value;
      switch (filterType) {
        case 0:
          value = filt;
          break;
        case 1:
          value = filt + a;
          break;
        case 2:
          value = filt + b;
          break;
        case 3:
          value = filt + Math.floor((a + b) / 2);
          break;
        case 4:
          value = filt + paethPredictor(a, b, c);
          break;
        default:
          throw new TypeError(`Unsupported PNG filter type ${filterType}.`);
      }
      output[dstRowStart + x] = value & 0xff;
    }
    priorRowStart = dstRowStart;
  }
  return output;
}

/**
 * Minimal PNG encoder used only by this module's own tests, so
 * `unfilterScanlines`/`decodePng` can be exercised end-to-end without a real
 * screenshot fixture. Always uses filter type 0 (None) for every scanline;
 * `unfilterScanlines`'s other filter branches are covered directly with
 * hand-built byte sequences instead.
 */
export function encodeMinimalPngForTests(width, height, rgbaPixels) {
  if (rgbaPixels.length !== width * height * 4) {
    throw new TypeError("rgbaPixels length must be width*height*4.");
  }
  const rowBytes = width * 4;
  const filtered = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    filtered[row * (rowBytes + 1)] = 0; // filter type: None
    filtered.set(
      rgbaPixels.subarray(row * rowBytes, row * rowBytes + rowBytes),
      row * (rowBytes + 1) + 1,
    );
  }
  const compressed = deflateSync(Buffer.from(filtered));

  const ihdrData = new Uint8Array(13);
  writeUint32BE(ihdrData, 0, width);
  writeUint32BE(ihdrData, 4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: truecolor with alpha
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method

  return concatBytes([
    PNG_SIGNATURE,
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type, data) {
  const length = new Uint8Array(4);
  writeUint32BE(length, 0, data.length);
  const typeBytes = Uint8Array.from([...type].map((char) => char.charCodeAt(0)));
  const crcPlaceholder = new Uint8Array(4); // decodePng does not verify CRC32.
  return concatBytes([length, typeBytes, data, crcPlaceholder]);
}

function parseIhdr(data) {
  if (data.length !== 13) throw new TypeError("Malformed IHDR chunk.");
  return {
    width: readUint32BE(data, 0),
    height: readUint32BE(data, 4),
    bitDepth: data[8],
    colorType: data[9],
    compressionMethod: data[10],
    filterMethod: data[11],
    interlaceMethod: data[12],
  };
}

function channelsForColorType(colorType) {
  switch (colorType) {
    case 2:
      return 3; // truecolor RGB
    case 6:
      return 4; // truecolor with alpha
    case 0:
      return 1; // grayscale
    case 4:
      return 2; // grayscale with alpha
    default:
      throw new TypeError(
        `Unsupported PNG color type ${colorType}; only grayscale/RGB/RGBA truecolor images are supported.`,
      );
  }
}

function expandToRgba(raw, width, height, channels) {
  if (channels === 4) return raw;
  const pixels = new Uint8Array(width * height * 4);
  for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
    const src = pixelIndex * channels;
    const dst = pixelIndex * 4;
    if (channels === 3) {
      pixels[dst] = raw[src];
      pixels[dst + 1] = raw[src + 1];
      pixels[dst + 2] = raw[src + 2];
      pixels[dst + 3] = 255;
    } else if (channels === 1) {
      pixels[dst] = raw[src];
      pixels[dst + 1] = raw[src];
      pixels[dst + 2] = raw[src];
      pixels[dst + 3] = 255;
    } else if (channels === 2) {
      pixels[dst] = raw[src];
      pixels[dst + 1] = raw[src];
      pixels[dst + 2] = raw[src];
      pixels[dst + 3] = raw[src + 1];
    }
  }
  return pixels;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readUint32BE(bytes, offset) {
  return (
    (bytes[offset] * 0x1000000) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function writeUint32BE(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function asciiChunkType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}
