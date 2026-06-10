/**
 * Perceptual hashing (dHash) for near-duplicate image detection.
 *
 * dHash is robust to resize/recompression/minor color shifts — exactly the kind
 * of variation that makes two AI-generated designs "the same to a buyer" without
 * being byte-identical. We use it to skip re-validating / re-publishing designs
 * that are visually a duplicate of a recent one (see phash-index.ts).
 *
 * Algorithm: grayscale → resize to 9×8 → for each row, emit 1 bit per adjacent
 * pixel pair (left < right). 8 rows × 8 comparisons = 64 bits → 16-char hex.
 */
import sharp from "sharp";

/** Computes the 64-bit dHash of an image buffer, as a 16-char hex string. */
export async function perceptualHash(input: Buffer): Promise<string> {
  const { data } = await sharp(input)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col] as number;
      const right = data[row * 9 + col + 1] as number;
      hash = (hash << 1n) | (left < right ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

/** Hamming distance between two 16-char hex dHashes (0 = identical, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let dist = 0;
  while (x > 0n) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return dist;
}
