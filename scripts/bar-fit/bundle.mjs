// BAR FIT — a light local build of the app for the screenshot harness (the Vite dev server needs ~1 GB
// on this box). esbuild bundles src/main.jsx for the browser; index.css goes through the project's own
// PostCSS (Tailwind + autoprefixer) first. No service worker, no PWA — layout only.
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export async function bundleApp(ROOT, OUTDIR) {
  rmSync(OUTDIR, { recursive: true, force: true });
  mkdirSync(OUTDIR, { recursive: true });
  const cssPlugin = { name: "postcss-index", setup(b) {
    b.onLoad({ filter: /src[\\/]index\.css$/ }, async (a) => {
      const src = readFileSync(a.path, "utf8");
      const r = await postcss([tailwind({ config: resolve(ROOT, "tailwind.config.js") }), autoprefixer]).process(src, { from: a.path });
      return { contents: r.css, loader: "css" };
    });
  } };
  await build({
    entryPoints: { bundle: resolve(ROOT, "src/main.jsx") }, outdir: OUTDIR, bundle: true, format: "esm", splitting: true,
    jsx: "automatic", loader: { ".js": "jsx", ".png": "file", ".jpg": "file", ".jpeg": "file", ".svg": "file", ".webp": "file", ".woff2": "file", ".mp3": "file" },
    define: { "import.meta.env": JSON.stringify({ MODE: "bar-fit", DEV: false, PROD: true, VITE_API_URL: "/api" }), "process.env.NODE_ENV": '"production"' },
    minify: true, sourcemap: false, logLevel: "error", plugins: [cssPlugin], external: ["https://*"], publicPath: "/",
  });
  const html = readFileSync(resolve(ROOT, "index.html"), "utf8")
    .replace(/<script[^>]*src="\/src\/main\.jsx"[^>]*><\/script>/, `<link rel="stylesheet" href="/bundle.css"><script type="module" src="/bundle.js"></script>`);
  writeFileSync(resolve(OUTDIR, "index.html"), html);
  return OUTDIR;
}
