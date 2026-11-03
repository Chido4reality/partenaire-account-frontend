// PHOTO UPLOADS FIT THROUGH THE VERCEL PROXY — red guards for src/utils/photoCompress.js
// and every place the app uploads an image (2026-11-03, Orange fallback).
//
// Through the proxy a request body over ~4.5 MB is refused, and a photo travels as a
// base64 data URL inside JSON. The promises:
//   • every product photo is re-encoded: JPEG, long side ≤ 1600 px, ~1 MB
//   • quality, then size, steps down until it fits; nothing over the hard cap is returned
//   • the worst body the app can build stays far under 4.5 MB (and under the server's 5 MB)
//   • no upload path sends the picked file as-is (product photos, logo)
import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const OUT = resolve(HERE, "__photo_compress.mjs");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };
const VERCEL_BODY_LIMIT = 4.5 * 1024 * 1024;

try {
  await build({ entryPoints: [resolve(SRC, "utils/photoCompress.js")], outfile: OUT, bundle: true, format: "esm", platform: "node", logLevel: "silent" });
  const P = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);

  console.log("\n-- A. size rules --\n");
  const f1 = P.fitWithin(4000, 3000), f2 = P.fitWithin(3000, 4000), f3 = P.fitWithin(1200, 800), f4 = P.fitWithin(1600, 1600);
  check("A1 a 4000×3000 camera photo → 1600×1200 (long side capped, ratio kept)", f1.width === 1600 && f1.height === 1200, JSON.stringify(f1));
  check("A2 portrait 3000×4000 → 1200×1600", f2.width === 1200 && f2.height === 1600, JSON.stringify(f2));
  check("A3 a smaller photo is never upscaled (1200×800 stays)", f3.width === 1200 && f3.height === 800, JSON.stringify(f3));
  check("A4 exactly 1600 stays 1600", f4.width === 1600 && f4.height === 1600);
  check("A5 the cap is 1600 px and the target ~1 MB of JPEG", P.MAX_SIDE === 1600 && P.TARGET_CHARS <= 1_400_000);

  console.log("\n-- B. the encode ladder (scripted encoder: size per scale × quality) --\n");
  const jpeg = (chars) => "data:image/jpeg;base64," + "A".repeat(Math.max(0, chars - 23));
  // A photo whose size falls with quality and with scale.
  const calls = [];
  const sizer = (big) => async (scale, q) => { calls.push([scale, q]); return jpeg(Math.round(big * scale * scale * q)); };
  let out = await P.encodeUnderTarget(sizer(1_500_000));
  check("B1 already small enough at the first step → returned at once (one encode, q 0.85, full size)",
    calls.length === 1 && calls[0][0] === 1 && calls[0][1] === 0.85 && out.length <= P.TARGET_CHARS, JSON.stringify(calls));
  calls.length = 0;
  out = await P.encodeUnderTarget(sizer(2_200_000));
  check("B2 too big → quality steps DOWN at full size before any shrinking", calls.every(([s]) => s === 1) && out.length <= P.TARGET_CHARS,
    JSON.stringify(calls));
  calls.length = 0;
  out = await P.encodeUnderTarget(sizer(9_000_000));
  check("B3 still too big at the lowest quality → the size steps down too, until it fits",
    calls.some(([s]) => s < 1) && out && out.length <= P.TARGET_CHARS, `${calls.length} encodes, ${out && out.length} chars`);
  calls.length = 0;
  out = await P.encodeUnderTarget(async () => jpeg(2_500_000));
  check("B4 never reaches the target but is under the hard cap → the smallest version is sent", out && out.length === 2_500_000);
  out = await P.encodeUnderTarget(async () => jpeg(P.HARD_CAP_CHARS + 1));
  check("B5 over the hard cap at every step → NOTHING is returned (the cashier gets an error, Vercel never sees it)", out === null);
  out = await P.encodeUnderTarget(async () => "data:image/png;base64,AAAA");
  check("B6 a non-JPEG result is never accepted", out === null);

  console.log("\n-- C. the worst body the app can send --\n");
  const worstBody = JSON.stringify({ data_url: jpeg(P.HARD_CAP_CHARS) }).length;
  check("C1 the largest possible photo body is far under Vercel's 4.5 MB", worstBody < VERCEL_BODY_LIMIT * 0.75, `${worstBody} bytes`);
  const decoded = Math.ceil(P.HARD_CAP_CHARS * 3 / 4);
  check("C2 …and its image is under the server's 5 MB cap (products.js)", decoded < 5 * 1024 * 1024, `${decoded} bytes decoded`);

  console.log("\n-- D. every upload path goes through it --\n");
  const inv = readFileSync(resolve(SRC, "pages/InventoryPage.jsx"), "utf8");
  const fnStart = inv.indexOf("async function readPhotoToDataUrl");
  const fnBody = inv.slice(fnStart, inv.indexOf("\n}\n", fnStart));
  check("D1 the product-photo reader delegates to compressPhoto (no own resize, no early return of the picked file)",
    fnStart >= 0 && /return compressPhoto\(file, lang\);/.test(fnBody) && !/toDataURL|readAsDataURL|return dataUrl/.test(fnBody), fnBody.length + " chars");
  const posts = [...inv.matchAll(/api\.post\(`\/products\/\$\{[^}]+\}\/photo`, \{ data_url: ([\w.]+) \}\)/g)].map((m) => m[1]);
  check("D2 all 3 product-photo uploads send a value produced by readPhotoToDataUrl",
    posts.length === 3 && (inv.match(/await readPhotoToDataUrl\(f, lang\)/g) || []).length === 2 && /readPhotoToDataUrl\(file, lang\)\s*\n?\s*\.then\(dataUrl => dataUrl && setNewProduct\(p => \(\{ \.\.\.p, photo_data_url: dataUrl \}\)\)\)/.test(inv),
    posts.join(", "));
  check("D3 InventoryPage has no other image encoder (toDataURL / readAsDataURL)", !/toDataURL|readAsDataURL/.test(inv));
  const set = readFileSync(resolve(SRC, "pages/SettingsPage.jsx"), "utf8");
  const logo = set.slice(set.indexOf("const handleLogoFile"), set.indexOf("reader.readAsDataURL(file);", set.indexOf("const handleLogoFile")));
  check("D4 the shop logo never falls back to the picked file as-is (any size)", logo.length > 0 && !/setFF\("logo_url", ev\.target\.result\)/.test(logo));
  check("D5 …and a logo data URL over its cap is refused", /url\.length <= LOGO_MAX_CHARS/.test(logo) && /LOGO_MAX_CHARS = 1_000_000/.test(set));
  const staff = set.slice(set.indexOf("function compressImageFile"), set.indexOf("function compressImageFile") + 1400);
  check("D6 staff photos stay small: 512 px JPEG (unchanged)", /maxDim = 512/.test(staff) && /toDataURL\("image\/jpeg", quality\)/.test(staff));
  const pc = readFileSync(resolve(SRC, "utils/photoCompress.js"), "utf8");
  check("D7 transparency is painted white before the JPEG encode", /fillStyle = "#ffffff"/.test(pc) && pc.indexOf("fillRect") < pc.indexOf("drawImage"));
} catch (e) {
  fails++; console.log(`  FAIL  threw: ${e.stack || e.message}`);
} finally {
  rmSync(OUT, { force: true });
}
console.log(`\n${fails ? `FAIL (${fails})` : "PASS"}`);
process.exit(fails ? 1 : 0);
