import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// Wide enough for a card on a sharp screen; a tall page keeps its length up to this.
const MOST_WIDE = 1400;
const MOST_TALL = 8000;
// Read from the file's header first, so a huge picture is refused before it fills memory.
const MOST_PIXELS = 40_000_000;
const QUALITY = 80;
const PNG_SIGNATURE = "89504e470d0a1a0a";

export interface Picture {
  type: string;
  bytes: Uint8Array;
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export class PictureError extends Error {}

function decode(bytes: Buffer, type: string): Pixels {
  if (type === "image/png") {
    if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
      throw new PictureError("That file is not a PNG picture.");
    }
    if (bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > MOST_PIXELS) {
      throw new PictureError("That picture is too large to show. Show a smaller one.");
    }
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: MOST_PIXELS / 1_000_000,
  });
}

// Each block of source pixels averaged into one, over white where the picture is see-through.
function scaled({ width, height, data }: Pixels, scale: number): Pixels {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(w * h * 4);
  for (let ty = 0; ty < h; ty++) {
    const y0 = Math.floor((ty * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / h));
    for (let tx = 0; tx < w; tx++) {
      const x0 = Math.floor((tx * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          const alpha = (data[i + 3] ?? 255) / 255;
          const white = 255 * (1 - alpha);
          r += (data[i] ?? 0) * alpha + white;
          g += (data[i + 1] ?? 0) * alpha + white;
          b += (data[i + 2] ?? 0) * alpha + white;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const o = (ty * w + tx) * 4;
      out[o] = r / count;
      out[o + 1] = g / count;
      out[o + 2] = b / count;
      out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

function pngOf({ width, height, data }: Pixels): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  return PNG.sync.write(png, { deflateLevel: 9 });
}

// Kept small so pictures never grow the store: scaled to fit, then the smallest of JPEG, the
// original if it already fits, or a PNG for a PNG, as flat screens and diagrams pack best that way.
export function shrink(bytes: Buffer, type: string): Picture {
  let pixels: Pixels;
  try {
    pixels = decode(bytes, type);
  } catch (error) {
    if (error instanceof PictureError) throw error;
    throw new PictureError("That picture could not be read. Save it again as PNG or JPEG.");
  }
  const scale = Math.min(1, MOST_WIDE / pixels.width, MOST_TALL / pixels.height);
  const fitted = scaled(pixels, scale);
  const choices: Picture[] = [{ type: "image/jpeg", bytes: jpeg.encode(fitted, QUALITY).data }];
  if (scale === 1) choices.push({ type, bytes });
  else if (type === "image/png") choices.push({ type, bytes: pngOf(fitted) });
  return choices.reduce((best, one) => (one.bytes.length < best.bytes.length ? one : best));
}
