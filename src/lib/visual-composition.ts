import sharp from "sharp";
import path from "node:path";
import os from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

let fontsReady: Promise<void> | undefined;
function prepareFonts() {
  return (fontsReady ??= (async () => {
    const fontDir = path.join(process.cwd(), "assets/fonts");
    const cache = path.join(
      os.tmpdir(),
      `vidsutra-fonts-${createHash("sha256").update(fontDir).digest("hex").slice(0, 12)}`,
    );
    await mkdir(cache, { recursive: true });
    const config = path.join(cache, "fonts.conf");
    await writeFile(
      config,
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${escapeVisualText(fontDir)}</dir><cachedir>${escapeVisualText(cache)}</cachedir></fontconfig>`,
    );
    // Bundled fonts and a writable cache avoid host-font dependencies on
    // macOS, Linux and serverless deployments.
    process.env.FONTCONFIG_FILE = config;
  })());
}

// Escape Pango markup: generated text never becomes SVG/HTML or an external URL.
export function escapeVisualText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
export async function normalizeVisual(
  input: Buffer,
  width: number,
  height: number,
) {
  await prepareFonts();
  const metadata = await sharp(input, {
    limitInputPixels: 20_000_000,
    animated: false,
  }).metadata();
  if (
    !["png", "jpeg", "webp"].includes(metadata.format || "") ||
    (metadata.pages ?? 1) > 1 ||
    !metadata.width ||
    !metadata.height ||
    metadata.width < 256 ||
    metadata.height < 256
  )
    throw new Error("Provider output is not a supported illustration.");
  return sharp(input, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize(width, height, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}
export async function composeVisual(
  artwork: Buffer,
  text: string,
  width: number,
  height: number,
) {
  await prepareFonts();
  const bandHeight = Math.round(height * 0.27);
  const fontfile = path.join(
    process.cwd(),
    "assets/fonts/NotoSansDevanagari.ttf",
  );
  const label = await sharp({
    text: {
      text: `<span foreground="#f4f2ff" weight="bold">${escapeVisualText(text)}</span>`,
      font: "Noto Sans Devanagari Bold",
      fontfile,
      width: width - 144,
      height: bandHeight - 100,
      rgba: true,
      align: "left",
      wrap: "word-char",
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const panel = Buffer.from(
    `<svg width="${width}" height="${bandHeight}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#0c101b" stop-opacity=".5"/><stop offset="1" stop-color="#0c101b" stop-opacity=".98"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect x="72" y="32" width="56" height="5" rx="2" fill="#75e3be"/></svg>`,
  );
  return sharp(artwork)
    .composite([
      { input: panel, top: height - bandHeight, left: 0 },
      { input: label.data, top: height - bandHeight + 62, left: 72 },
    ])
    .png()
    .toBuffer();
}
