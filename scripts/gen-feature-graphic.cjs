#!/usr/bin/env node
/**
 * Partenaire Dozie — Google Play feature graphic generator.
 *
 * Output: 1024x500 PNG, solid navy (#152B52), gold "P" mark (derived from the
 * brand art) on the left, "Partenaire Dozie" in gold (#FBC503) + a French
 * tagline underneath on the right. No screenshots / device frames (Play
 * forbids them in the feature graphic).
 *
 * Reuses the launcher generator's warmth-detection to lift the gold P off its
 * navy/white source background: a pixel is "gold" when (R - B) > threshold and
 * it isn't near-white; everything else becomes transparent. The trimmed P is
 * then downscaled (which anti-aliases the edges) and composited onto navy.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets/brand/launcher-source-1024.png');
const OUT = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'dozie-feature-graphic-1024x500.png');

const W = 1024, H = 500;
const NAVY = '#152B52';
const GOLD = '#FBC503';
const WARM_THRESHOLD = 10;   // keep pixel as "gold" if (R - B) > this
const NEAR_WHITE = 205;      // drop white corners (all channels above this)

const TITLE    = 'Partenaire Dozie';
const TAGLINE  = 'Trouvez des boutiques près de vous';

(async () => {
  // 1. Lift the gold P off the source -> gold-on-transparent RGBA.
  const src = sharp(SRC).ensureAlpha();
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data); // copy
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const warm = (r - b) > WARM_THRESHOLD;
    const white = r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE;
    out[o + 3] = (warm && !white) ? 255 : 0;
  }
  const goldP = await sharp(out, { raw: { width, height, channels } })
    .png()
    .trim()                                   // crop to the P's tight bbox
    .toBuffer();
  const pMeta = await sharp(goldP).metadata();

  // 2. Scale the P to fit the canvas height, place it left-of-center.
  const pH = 320;
  const pW = Math.round(pMeta.width * (pH / pMeta.height));
  const pScaled = await sharp(goldP).resize({ height: pH }).toBuffer();
  const pLeft = 95;
  const pTop = Math.round((H - pH) / 2);

  // 3. Text overlay (SVG) on the right of the P.
  const textX = pLeft + pW + 70;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .t { font-family: 'Segoe UI', 'Arial', sans-serif; font-weight: 800; }
      .s { font-family: 'Segoe UI', 'Arial', sans-serif; font-weight: 500; }
    </style>
    <text x="${textX}" y="250" class="t" font-size="70" fill="${GOLD}">${TITLE}</text>
    <text x="${textX}" y="305" class="s" font-size="31" fill="${GOLD}" fill-opacity="0.92">${TAGLINE}</text>
  </svg>`;

  // 4. Compose: navy base + P + text.
  await sharp({ create: { width: W, height: H, channels: 4, background: NAVY } })
    .composite([
      { input: pScaled, left: pLeft, top: pTop },
      { input: Buffer.from(svg), left: 0, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  const final = await sharp(OUT).metadata();
  const bytes = fs.statSync(OUT).size;
  console.log(`P bbox: ${pMeta.width}x${pMeta.height} -> scaled ${pW}x${pH} @ (${pLeft},${pTop})`);
  console.log(`text x=${textX}`);
  console.log(`OUTPUT: ${OUT}`);
  console.log(`dimensions: ${final.width}x${final.height}  format: ${final.format}  size: ${(bytes/1024).toFixed(1)} KB`);
})().catch(e => { console.error(e); process.exit(1); });
