// The admin portal has to be usable on a phone.
//
// Three things this pins, each of which was a real defect rather than a
// hypothetical one:
//   1. .table-wrap was `overflow: hidden` — it CLIPPED columns and showed no
//      scrollbar, so the data was gone with nothing on screen to say so.
//   2. 16 .data-table had no scroll container at all. They are wrapped at
//      runtime, because several are built by innerHTML inside async loaders.
//   3. The drawer must reuse the SAME .sb-link nodes as the desktop sidebar.
//      A duplicated mobile nav would need showApp's per-role hiding applied a
//      second time, in a second place — and a missed one leaks a route to a
//      marketer. That is a security-shaped bug, not a cosmetic one.
//
// The wrapping is exercised by running the REAL wrapTables() over a real DOM,
// not by reading the source for a call site.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");

let fails = 0;
const check = (label, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`);
};

console.log("\n── admin portal responsive ──────────────────────────────────\n");

// ── 1. the clipping wrapper ────────────────────────────────────────────────
// Strip CSS comments first: the block explains the old `overflow: hidden` in
// prose, and matching that would fail the check on the very text describing
// the fix.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const wrapCss = stripComments(
  html.slice(html.indexOf(".table-wrap {"), html.indexOf(".table-wrap {") + 900));
check(".table-wrap never clips horizontally", !/overflow:\s*hidden/.test(wrapCss),
  (wrapCss.match(/overflow[^;]*;/g) || []).join(" ").trim());
check("…it scrolls on x instead", /overflow-x:\s*auto/.test(wrapCss));

// ── the grid column must be allowed to SHRINK ──────────────────────────────
// Found in the browser, invisible to any static check: a `1fr` column carries
// `min-width: auto`, so it refuses to go below its content's min-content
// width. A wide table pushed the column to 812px inside a 345px viewport — the
// whole PAGE scrolled sideways, and the table's own overflow-x never engaged,
// because a container free to grow never needs to scroll. Fixing the wrapper
// without this does nothing at all, which is why it is pinned here.
const shellCss = stripComments(html.slice(html.indexOf("#app-shell.active {"),
  html.indexOf("#app-shell.active {") + 400));
check("the desktop grid column may shrink (minmax(0,1fr), not bare 1fr)",
  /grid-template-columns:\s*var\(--sidebar-w\)\s*minmax\(0,\s*1fr\)/.test(shellCss),
  (shellCss.match(/grid-template-columns:[^;]*/) || ["?"])[0].trim());
check("main is allowed to shrink too (grid items also default to min-width:auto)",
  /main\s*\{\s*min-width:\s*0/.test(stripComments(html)));
const mobileBlock = stripComments(html.slice(html.lastIndexOf("@media (max-width: 900px) {")));
check("the mobile grid column may shrink as well",
  /#app-shell\.active\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(mobileBlock));


// ── 2. the drawer is the SAME nav, not a copy ──────────────────────────────
const asideCount = (html.match(/<aside class="sidebar"/g) || []).length;
check("exactly ONE sidebar element exists", asideCount === 1, `${asideCount} found`);
const navLists = (html.match(/class="sb-link"/g) || []).length;
const bodyHtml = html.slice(html.indexOf("<body>"));
const drawerDupe = /id="mobile-nav"|class="mobile-nav-list"|sb-link-mobile/.test(bodyHtml);
check("no duplicated mobile nav list (role scoping would need doing twice)",
  !drawerDupe, `${navLists} sb-link nodes, all in the one sidebar`);
check("the drawer toggles the same #sidebar element",
  /\$\('sidebar'\)/.test(html) && /sb\.classList\.toggle\('open'/.test(html));
for (const wire of ["nav-burger", "nav-scrim", "aria-expanded", "aria-controls=\"sidebar\""]) {
  check(`drawer is wired: ${wire}`, html.includes(wire));
}
check("Escape closes the drawer", /e\.key === 'Escape'\) closeNavDrawer/.test(html));
check("a route change closes it (hash edit / Back / redirect, not just a tap)",
  /closeNavDrawer\(\);[\s\S]{0,400}mt-title/.test(html));

// ── 3. run the REAL wrapTables() over a real DOM ───────────────────────────
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let src = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
const fnSrc = src.slice(src.indexOf("function wrapTables"), src.indexOf("function startTableObserver"));

// A DOM small enough to reason about, real enough to exercise the code.
const mkNode = (tag, cls = "") => {
  const n = {
    tagName: tag.toUpperCase(), className: cls, children: [], parentElement: null,
    style: {}, attrs: {},
    classList: {
      contains: (c) => n.className.split(/\s+/).includes(c),
      add: (c) => { n.className = (n.className + " " + c).trim(); },
    },
    setAttribute: (k, v) => { n.attrs[k] = v; },
    getAttribute: (k) => (k in n.attrs ? n.attrs[k] : null),
    querySelectorAll: (sel) => {
      if (sel === "thead th") return n._ths || [];
      return [];
    },
    insertBefore(newNode, ref) {
      const i = this.children.indexOf(ref);
      this.children.splice(i, 0, newNode);
      newNode.parentElement = this;
    },
    appendChild(c) {
      const p = c.parentElement;
      if (p) p.children.splice(p.children.indexOf(c), 1);
      this.children.push(c); c.parentElement = this;
    },
  };
  return n;
};
const mkTable = (cols) => {
  const t = mkNode("table", "data-table");
  t._ths = Array.from({ length: cols }, () => mkNode("th"));
  return t;
};

const host = mkNode("div", "host");
const wide = mkTable(9);      // many columns -> needs a floor
const narrow = mkTable(3);    // few columns -> a floor would be an annoyance
host.appendChild(wide); host.appendChild(narrow);

const ctx = {
  document: {
    querySelectorAll: (sel) => {
      const all = [];
      const walk = (n) => { for (const c of n.children) { all.push(c); walk(c); } };
      walk(host);
      return all.filter((n) => n.tagName === "TABLE"
        && n.className.includes("data-table")
        && n.getAttribute("data-scroll-wrapped") === null);
    },
    createElement: (tag) => mkNode(tag),
  },
};
vm.createContext(ctx);
new vm.Script(fnSrc + "\n;globalThis.__wrap = wrapTables;").runInContext(ctx);
ctx.__wrap();

check("a wide table gets wrapped in a scroll container",
  wide.parentElement && wide.parentElement.className === "table-scroll",
  wide.parentElement && wide.parentElement.className);
check("…and gets a min-width floor so its columns stay legible",
  wide.style.minWidth === `${9 * 112}px`, wide.style.minWidth);
check("a NARROW table is wrapped but gets NO pointless floor",
  narrow.parentElement.className === "table-scroll" && !narrow.style.minWidth,
  narrow.style.minWidth || "no floor");

// Idempotence is what stops the MutationObserver looping on its own writes.
const before = host.children.length;
ctx.__wrap(); ctx.__wrap();
check("re-running wraps nothing twice (the observer cannot loop)",
  host.children.length === before, `${host.children.length} vs ${before}`);

console.log(`\n  ${fails === 0 ? "ALL" : fails + " FAILED of"} responsive checks\n`);
process.exit(fails === 0 ? 0 : 1);
