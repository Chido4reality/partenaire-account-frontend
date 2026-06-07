#!/usr/bin/env node
/**
 * MP launcher-icon generator — brand navy+gold "P".
 *
 * Input : assets/brand/launcher-source-1024.png.jpg  (1024x1024 artwork:
 *         gold P + pin on a navy squircle with white corners)
 *
 * The artwork is an iOS-style squircle with WHITE corners and a navy that is
 * slightly off-brand (#162743). For Android we normalize it:
 *   - Every non-gold pixel (navy + white corners) -> brand navy #152B52,
 *     giving a clean FULL-BLEED navy field (system applies its own mask).
 *   - "Gold" is detected by warmth (R-B), which keeps the gold strokes AND
 *     their anti-aliased edges while dropping navy/white.
 *
 * Output:
 *   android/.../mipmap-*\/ic_launcher.png            full-bleed navy + gold P
 *   android/.../mipmap-*\/ic_launcher_round.png      same, circle-masked
 *   android/.../mipmap-*\/ic_launcher_foreground.png gold P on transparent,
 *                                                    scaled into the safe zone
 *   assets/brand/launcher-source-1024.png            cleaned full-bleed PNG
 *   assets/brand/play_store_icon_512.png             512 hi-res (full-bleed)
 *   assets/brand/_logo_transparent_1024.png          gold-on-transparent (debug)
 *
 * Adaptive BACKGROUND is the color resource @color/ic_launcher_background,
 * set to #152B52 — so no background PNG is emitted.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_CANDIDATES = [
  path.join(ROOT, 'assets/brand/launcher-source-1024.png'),
  path.join(ROOT, 'assets/brand/launcher-source-1024.png.jpg'),
];
const RES = path.join(ROOT, 'android/app/src/main/res');

const NAVY = { r: 0x15, g: 0x2b, b: 0x52 }; // #152B52
const WARM_THRESHOLD = 12;   // keep pixel as "gold" if (R - B) > this
const NEAR_WHITE = 200;      // min channel above this = white corner -> drop

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const SAFE_FRACTION = 72 / 108; // adaptive-icon safe zone

function findSource() {
  for (const p of SRC_CANDIDATES) if (fs.existsSync(p)) return p;
  console.error(`\n✗ Source not found. Looked for:\n  ${SRC_CANDIDATES.join('\n  ')}\n`);
  process.exit(1);
}

(async () => {
  const SRC = findSource();
  const meta = await sharp(SRC).metadata();
  console.log(`Source: ${SRC.replace(ROOT + path.sep, '')} — ${meta.width}x${meta.height} ${meta.format}`);
  if (meta.width !== meta.height) console.warn('  ⚠ source is not square.');

  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const N = W * H;

  // Two normalized buffers, built pixel-by-pixel from a warmth key.
  const full = Buffer.alloc(N * 4);  // RGBA, opaque navy field + gold
  const fg = Buffer.alloc(N * 4);    // RGBA, gold on transparent
  let minX = W, minY = H, maxX = -1, maxY = -1, goldCount = 0;

  for (let i = 0; i < N; i++) {
    const s = i * ch, d = i * 4;
    const r = data[s], g = data[s + 1], b = data[s + 2];
    const isWhite = Math.min(r, g, b) > NEAR_WHITE;
    const isGold = !isWhite && (r - b) > WARM_THRESHOLD;
    if (isGold) {
      full[d] = r; full[d + 1] = g; full[d + 2] = b; full[d + 3] = 255;
      fg[d] = r; fg[d + 1] = g; fg[d + 2] = b; fg[d + 3] = 255;
      goldCount++;
      const x = i % W, y = (i / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else {
      full[d] = NAVY.r; full[d + 1] = NAVY.g; full[d + 2] = NAVY.b; full[d + 3] = 255;
      fg[d] = 0; fg[d + 1] = 0; fg[d + 2] = 0; fg[d + 3] = 0;
    }
  }
  if (maxX < 0) { console.error('✗ No gold detected — check WARM_THRESHOLD.'); process.exit(1); }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const pct = ((goldCount / N) * 100).toFixed(1);
  console.log(`Gold pixels: ${goldCount} (${pct}%); logo bbox ${bw}x${bh} at (${minX},${minY})`);

  const fullPng = await sharp(full, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const fgPng = await sharp(fg, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();

  // Persist cleaned sources / debug artifacts.
  fs.writeFileSync(path.join(ROOT, 'assets/brand/launcher-source-1024.png'), fullPng);
  fs.writeFileSync(path.join(ROOT, 'assets/brand/_logo_transparent_1024.png'), fgPng);

  // Square crop of the gold bbox (+6% margin) for the adaptive foreground.
  const side0 = Math.max(bw, bh);
  const margin = Math.round(side0 * 0.06);
  let side = side0 + margin * 2;
  const cx = minX + bw / 2, cy = minY + bh / 2;
  let left = Math.round(cx - side / 2), top = Math.round(cy - side / 2);
  left = Math.max(0, left); top = Math.max(0, top);
  side = Math.min(side, W - left, H - top);
  const logoCrop = await sharp(fgPng).extract({ left, top, width: side, height: side }).png().toBuffer();
  console.log(`Foreground square crop: ${side}px at (${left},${top})`);

  // circle mask helper
  const circle = (size) => Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );

  for (const [d, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await sharp(fullPng).resize(size, size, { fit: 'cover' }).png().toFile(path.join(dir, 'ic_launcher.png'));
    const round = await sharp(fullPng).resize(size, size, { fit: 'cover' }).png().toBuffer();
    await sharp(round).composite([{ input: circle(size), blend: 'dest-in' }]).png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  for (const [d, canvas] of Object.entries(FOREGROUND)) {
    const dir = path.join(RES, `mipmap-${d}`);
    const inner = Math.round(canvas * SAFE_FRACTION);
    const logo = await sharp(logoCrop)
      .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logo, gravity: 'center' }]).png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  await sharp(fullPng).resize(512, 512, { fit: 'cover' }).png()
    .toFile(path.join(ROOT, 'assets/brand/play_store_icon_512.png'));

  console.log('\n✓ Icons generated (background resource = #152B52).');
})();
