// PHOTO COMPRESSION (2026-11-03, Orange fallback). Every product photo is re-encoded
// here before upload: JPEG, long side ≤ 1600 px, aiming at ~1 MB.
//
// WHY: through the Vercel proxy a request body may not exceed ~4.5 MB, and the photo
// travels as a base64 data URL (~4/3 of the image bytes) inside a JSON body. The old
// resize sent small photos UNTOUCHED (any format under 1.5 MB) and kept PNGs as PNG, so
// a 1920 px PNG could pass the limit. Now nothing is sent as picked.
//
// THE RULES (each one is a red guard in scripts/photo-upload-check.mjs):
//   • always re-encoded, always image/jpeg (transparency is painted white first);
//   • long side capped at MAX_SIDE, aspect ratio kept, never upscaled;
//   • quality steps down, then size steps down, until the data URL is ≤ TARGET_CHARS;
//   • a data URL over HARD_CAP_CHARS is never returned — the cashier gets an error
//     instead of a request Vercel would refuse.
export const MAX_SIDE = 1600;
export const TARGET_CHARS = 1_400_000;   // data URL length ≈ a 1 MB JPEG
export const HARD_CAP_CHARS = 3_000_000; // ≈ 2.2 MB JPEG; the JSON body stays far under 4.5 MB
export const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.45];
export const SCALES = [1, 0.75, 0.5];

export function fitWithin(width, height, maxSide = MAX_SIDE) {
  const w = Number(width) || 0, h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(maxSide / w, maxSide / h, 1);
  return { width: Math.max(1, Math.round(w * ratio)), height: Math.max(1, Math.round(h * ratio)) };
}

// encode(scale, quality) → a JPEG data URL. Kept separate from the canvas so the
// size ladder can be checked without a browser.
export async function encodeUnderTarget(encode, { target = TARGET_CHARS, hardCap = HARD_CAP_CHARS } = {}) {
  let smallest = null;
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      const url = await encode(scale, quality);
      if (typeof url !== "string" || !url.startsWith("data:image/jpeg")) continue;
      if (url.length <= target) return url;
      if (!smallest || url.length < smallest.length) smallest = url;
    }
  }
  if (smallest && smallest.length <= hardCap) return smallest;
  return null;   // even the smallest version is too big: refuse, never send it
}

function tooBig(lang) {
  return new Error(lang === "en"
    ? "This photo is too large to send. Please take it again or pick a smaller one."
    : "Cette photo est trop lourde pour l'envoi. Reprenez-la ou choisissez-en une plus petite.");
}

// Browser only: File → JPEG data URL (or throws a bilingual Error).
export async function compressPhoto(file, lang) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(lang === "en" ? "Read failed" : "Lecture impossible"));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(lang === "en" ? "This image could not be opened" : "Impossible d'ouvrir cette image"));
    img.src = dataUrl;
  });
  const base = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (!base.width) throw new Error(lang === "en" ? "This image could not be opened" : "Impossible d'ouvrir cette image");
  const canvas = document.createElement("canvas");
  const encode = (scale, quality) => {
    const w = Math.max(1, Math.round(base.width * scale)), h = Math.max(1, Math.round(base.height * scale));
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";          // a transparent PNG would turn black as JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const out = await encodeUnderTarget(encode);
  if (!out) throw tooBig(lang);
  return out;
}
