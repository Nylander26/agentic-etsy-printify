import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { perceptualHash, hammingDistance } from "../src/lib/phash.js";

function solid(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

/** 16×16 image: left half dark, right half bright → guaranteed dHash bits set. */
function leftDarkRightBright(): Promise<Buffer> {
  const w = 16, h = 16;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x < w / 2 ? 0 : 255;
      const i = (y * w + x) * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = v;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("hammingDistance", () => {
  it("is 0 for identical hashes", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
  });

  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000001", "0000000000000000")).toBe(1);
    expect(hammingDistance("000000000000000f", "0000000000000000")).toBe(4);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
  });
});

describe("perceptualHash", () => {
  it("produces a 16-char hex hash", async () => {
    const h = await perceptualHash(await solid(128, 128, 128));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same image", async () => {
    const buf = await leftDarkRightBright();
    expect(await perceptualHash(buf)).toBe(await perceptualHash(buf));
  });

  it("gives distance 0 for two identical solid images", async () => {
    const a = await perceptualHash(await solid(200, 50, 50));
    const b = await perceptualHash(await solid(200, 50, 50));
    expect(hammingDistance(a, b)).toBe(0);
  });

  it("distinguishes a structured image from a flat one", async () => {
    const flat = await perceptualHash(await solid(128, 128, 128));
    const structured = await perceptualHash(await leftDarkRightBright());
    expect(hammingDistance(flat, structured)).toBeGreaterThan(0);
  });
});
