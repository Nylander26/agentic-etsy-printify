/**
 * Local AI upscaler via the standalone `realesrgan-ncnn-vulkan` binary.
 *
 * Why this and not Docker/Python: ncnn-vulkan is a single prebuilt executable that
 * runs on the GPU through Vulkan (works on most GPUs, including Intel iGPUs). No
 * Docker, no Python, no node-gyp — you just download the Windows build, unzip it,
 * and point `upscaler.binary_path` at the .exe.
 *
 * Setup:
 *   1. Download the Windows zip from the Real-ESRGAN ncnn releases
 *      (github.com/xinntao/Real-ESRGAN releases → `realesrgan-ncnn-vulkan-*-windows.zip`).
 *   2. Unzip somewhere (it contains the .exe + a `models/` folder).
 *   3. In config.yaml set `upscaler.enabled: true` and `upscaler.binary_path` to the .exe.
 *
 * Real detail (not interpolation) → genuinely sharp large prints, and crisp edges
 * compress far better, so the upload stays lossless (no HTTP 413).
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { getConfig } from "./config.js";
import { env } from "./env.js";

/**
 * Binary path comes from the UPSCALER_BINARY_PATH env var (in .env, gitignored) first,
 * falling back to config.yaml. Keep the real machine path in .env so it never lands in
 * version control.
 */
function binaryPath(): string {
  return env.UPSCALER_BINARY_PATH ?? getConfig().upscaler.binary_path;
}

export function isUpscalerEnabled(): boolean {
  const path = binaryPath();
  return getConfig().upscaler.enabled && !!path && existsSync(path);
}

/**
 * Upscales a PNG buffer with the configured realesrgan model. Throws when the
 * upscaler is disabled or the binary is missing so callers can fall back to plain
 * sharp resizing — never silently degrade.
 */
export async function upscaleBuffer(input: Buffer): Promise<Buffer> {
  const cfg = getConfig().upscaler;
  const bin = binaryPath();
  if (!cfg.enabled) throw new Error("upscaler disabled (upscaler.enabled=false)");
  if (!bin || !existsSync(bin)) {
    throw new Error(`realesrgan binary not found at "${bin}" (set UPSCALER_BINARY_PATH in .env)`);
  }

  const tag = randomBytes(6).toString("hex");
  const inPath = join(tmpdir(), `up-${tag}-in.png`);
  const outPath = join(tmpdir(), `up-${tag}-out.png`);
  writeFileSync(inPath, input);

  try {
    // Run with cwd = the binary's folder so it finds its sibling `models/` dir.
    await runBinary(
      bin,
      ["-i", inPath, "-o", outPath, "-n", cfg.model, "-s", String(cfg.scale), "-f", "png"],
      dirname(bin)
    );
    if (!existsSync(outPath)) throw new Error("upscaler produced no output file");
    return readFileSync(outPath);
  } finally {
    try { rmSync(inPath, { force: true }); } catch { /* ignore */ }
    try { rmSync(outPath, { force: true }); } catch { /* ignore */ }
  }
}

function runBinary(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd, windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += String(d);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`realesrgan exited with code ${code}: ${stderr.slice(-300)}`));
    });
  });
}
