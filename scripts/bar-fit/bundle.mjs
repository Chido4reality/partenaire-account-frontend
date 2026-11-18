// BAR FIT — a light local build of the app for the screenshot harness (the Vite dev server needs ~1 GB
// on this box). esbuild bundles src/main.jsx for the browser; index.css goes through the project's own
// PostCSS (Tailwind + autoprefixer) first. No service worker, no PWA — layout only.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// mutate (teeth tests): [{ file: /regex on the path/, from: "exact text", to: "text" }] — applied to a COPY in
// the bundle only (the tree is never touched); a "from" not found exactly once throws, so a teeth run can
// never pass on an unmutated file.
export async function bundleApp(ROOT, OUTDIR, { mutate = [] } = {}) {
  rmSync(OUTDIR, { recursive: true, force: true });
  mkdirSync(OUTDIR, { recursive: true });
  const cssPlugin = { name: "postcss-index", setup(b) {
    b.onLoad({ filter: /src[\\/]index\.css$/ }, async (a) => {
      const src = readFileSync(a.path, "utf8");
      const r = await postcss([tailwind({ config: resolve(ROOT, "tailwind.config.js") }), autoprefixer]).process(src, { from: a.path });
      return { contents: r.css, loader: "css" };
    });
  } };
  const hits = mutate.map(() => 0);
  const mutatePlugin = { name: "teeth-mutate", setup(b) {
    if (!mutate.length) return;
    b.onLoad({ filter: /src[\\/].*\.(jsx?|mjs)$/ }, (a) => {
      const idx = mutate.map((m, i) => (m.file.test(a.path.split(String.fromCharCode(92)).join("/")) ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) return undefined;
      let src = readFileSync(a.path, "utf8");
      for (const i of idx) { const n = src.split(mutate[i].from).length - 1;
        if (n !== 1) throw new Error(`teeth mutation ${i} expected 1 copy in ${a.path}, found ${n}`);
        src = src.replace(mutate[i].from, mutate[i].to); hits[i]++; }
      return { contents: src, loader: "jsx" };
    });
  } };
  await build({
    entryPoints: { bundle: resolve(ROOT, "src/main.jsx") }, outdir: OUTDIR, bundle: true, format: "esm", splitting: true,
    jsx: "automatic", loader: { ".js": "jsx", ".png": "file", ".jpg": "file", ".jpeg": "file", ".svg": "file", ".webp": "file", ".woff2": "file", ".mp3": "file" },
    define: { "import.meta.env": JSON.stringify({ MODE: "bar-fit", DEV: false, PROD: true, VITE_API_URL: "/api" }), "process.env.NODE_ENV": '"production"' },
    minify: true, sourcemap: false, logLevel: "error", plugins: [cssPlugin, mutatePlugin], external: ["https://*"], publicPath: "/",
  });
  const missed = hits.map((h, i) => (h === 1 ? -1 : i)).filter((i) => i >= 0);
  if (missed.length) throw new Error(`teeth mutation(s) ${missed.join(",")} did not land exactly once`);
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8")
    .replace(/<script[^>]*src="\/src\/main\.jsx"[^>]*><\/script>/, `<link rel="stylesheet" href="/bundle.css"><script type="module" src="/bundle.js"></script>`);
  writeFileSync(resolve(OUTDIR, "index.html"), html);
  return OUTDIR;
}

// CLI: node scripts/bar-fit/bundle.mjs → builds into <tmp>/bar-fit-app (then BAR_FIT_PREBUILT=1 for shots.mjs)
if (process.argv[1] && process.argv[1].split(String.fromCharCode(92)).join("/").endsWith("scripts/bar-fit/bundle.mjs")) {
  const os = await import("node:os"); const { fileURLToPath } = await import("node:url");
  const root = resolve(fileURLToPath(import.meta.url), "../../..");
  // BAR_CART_TEETH=1|2 → a MUTATED copy into <tmp>/bar-fit-app-teeth<N> (see cart-teeth.mjs)
  const t = process.env.BAR_CART_TEETH;
  const mutate = t ? (await import("./cart-teeth.mjs")).CART_TEETH[t] : [];
  if (t && !mutate) throw new Error(`unknown BAR_CART_TEETH=${t}`);
  console.log("built", await bundleApp(root, resolve(os.tmpdir(), t ? `bar-fit-app-teeth${t}` : "bar-fit-app"), { mutate }));
}
