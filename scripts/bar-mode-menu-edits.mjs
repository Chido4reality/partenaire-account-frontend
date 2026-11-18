// BAR MODE — the ONLY edits later steps may make to the menu / route / nav files, as exact strings.
// bar-mode-step1-check.mjs and bar-mode-step2-check.mjs undo exactly these on the CURRENT file and
// require the result to be byte-identical to the base (the tree before Bar Mode). Any other change
// to a menu file — a removed line, a moved entry, a changed gate — fails both checks.
//
// Each edit: [file, insertedText, afterAnchor]  (insert)  or  [file, newText, null, oldText] (replace).
export const MENU_EDITS = [
  ["src/App.jsx", `import BarPage from "./pages/BarPage"; // BAR MODE step 2\n`, null],
  ["src/App.jsx", `  // BAR MODE step 2: the server refuses every /bar action outside a bar location; the menu entry
  // shows only when GET /bar/mine lists a bar for this person.
  "/bar":          ["owner", "manager", "cashier"],\n`, null],
  ["src/App.jsx", `            <Route path="bar"     element={<RoleGuard path="/bar"><BarPage /></RoleGuard>} />\n`, null],
  ["src/components/common/Layout.jsx", `  // BAR MODE step 2: shown ONLY when GET /bar/mine lists a bar for this person (barOnly below).
  { to: "/bar",     en: "Bar",     fr: "Bar",      icon: "🍺", roles: ["owner","manager","cashier"], section: "sales", barOnly: true },\n`, null],
  ["src/components/common/Layout.jsx", `  // BAR MODE step 2: which bars may this person work at? Asked ONLY on Pro Plus, only for the three
  // roles that work a bar, and not when the org is already known to have Bar Mode off — every other
  // business makes no extra call. A failed read hides the entry (fail closed).
  const { data: barMine } = useQuery({
    queryKey: ["bar-mine"],
    queryFn: () => api.get("/bar/mine").then(r => r.data?.data || { bars: [] }),
    enabled: effectivePlan === "pro_plus" && ["owner", "manager", "cashier"].includes(role) && org?.bar_mode_enabled !== false,
    staleTime: 60000, retry: false,
  });
  const barNavVisible = (barMine?.bars || []).length > 0;\n`, null],
  ["src/components/common/Layout.jsx", `    if (item.barOnly && !barNavVisible) return false;   // BAR MODE: no bar → no entry (before any role rule)\n`, null],
  ["src/components/layout/NavDrawer.jsx", `"/pickup", "/bar", "/online-cart"`, null, `"/pickup", "/online-cart"`],
  // BAR LAYOUT (Peter 2026-11-18): /bar is full width — the desktop sidebar hides ONLY on /bar until the
  // bar's menu button opens it. These three edits are the whole Layout change; every other page is identical.
  ["src/components/common/Layout.jsx", `import { useBarChrome } from "../../store/barChrome";                                   // BAR LAYOUT: /bar hides the sidebar\n`, null],
  ["src/components/common/Layout.jsx", `  // BAR LAYOUT: on /bar the desktop sidebar is hidden unless the bar's menu button opened it; leaving /bar closes it.
  const barMenuOpen = useBarChrome((s) => s.menuOpen);
  const barFullWidth = location.pathname === "/bar" && !barMenuOpen;
  useEffect(() => { if (location.pathname !== "/bar") useBarChrome.getState().setMenuOpen(false); }, [location.pathname]);\n`, null],
  ["src/components/common/Layout.jsx", `, ...(barFullWidth ? { display: "none" } : {}) }}>`, null, ` }}>`],
];

/** The current text of `file` with every listed Bar Mode edit undone. Returns { text, missing }. */
export function undoMenuEdits(file, text) {
  const missing = [];
  for (const [f, now, , before] of MENU_EDITS) {
    if (f !== file) continue;
    const n = text.split(now).length - 1;
    if (n !== 1) { missing.push(`${f}: expected exactly one copy of ${JSON.stringify(now.slice(0, 50))}…, found ${n}`); continue; }
    text = text.replace(now, before ?? "");
  }
  return { text, missing };
}
