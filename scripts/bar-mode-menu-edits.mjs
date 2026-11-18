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
  // (BAR MODE BUTTON 2026-11-18: the plain "Bar" NAV entry, its barOnly filter and NavDrawer's "/bar" were
  // REMOVED — the Bar Mode button below replaces them; the query stays, the button reads its answer.)
  ["src/components/common/Layout.jsx", `  // BAR MODE step 2: which bars may this person work at? Asked ONLY on Pro Plus, only for the three
  // roles that work a bar, and not when the org is already known to have Bar Mode off — every other
  // business makes no extra call. A failed read hides the Bar Mode button (fail closed); the button
  // (BarModeButton) reads this answer from the shared cache and never fetches itself.
  useQuery({
    queryKey: ["bar-mine"],
    queryFn: () => api.get("/bar/mine").then(r => r.data?.data || { bars: [] }),
    enabled: effectivePlan === "pro_plus" && ["owner", "manager", "cashier"].includes(role) && org?.bar_mode_enabled !== false,
    staleTime: 60000, retry: false,
  });\n`, null],
  // BAR LAYOUT (Peter 2026-11-18): /bar is full width — the desktop sidebar hides ONLY on /bar until the
  // bar's menu button opens it. These three edits are the whole Layout change; every other page is identical.
  ["src/components/common/Layout.jsx", `import { useBarChrome } from "../../store/barChrome";                                   // BAR LAYOUT: /bar hides the sidebar\n`, null],
  ["src/components/common/Layout.jsx", `  // BAR LAYOUT: on /bar the desktop sidebar is hidden unless the bar's menu button opened it; leaving /bar closes it.
  const barMenuOpen = useBarChrome((s) => s.menuOpen);
  const barFullWidth = location.pathname === "/bar" && !barMenuOpen;
  useEffect(() => { if (location.pathname !== "/bar") useBarChrome.getState().setMenuOpen(false); }, [location.pathname]);\n`, null],
  ["src/components/common/Layout.jsx", `, ...(barFullWidth ? { display: "none" } : {}) }}>`, null, ` }}>`],
  // BAR FIT (Peter 2026-11-18): on /bar only, the desktop shell gets a class so the bar's own CSS can use
  // 100dvh (the VISIBLE height on a tablet with the address bar showing); every other page keeps 100vh.
  ["src/components/common/Layout.jsx", `<div className={location.pathname === "/bar" ? "bar-shell" : undefined} style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>`, null,
    `<div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>`],
  // BAR MODE BUTTON (Peter 2026-11-18): a Bar Mode button ABOVE the Warehouse Mode button (sidebar + phone
  // drawer). BarModeButton renders NOTHING unless /bar/mine lists a bar, so for every other business
  // the menu is what it was; with these four insertions undone every menu file is the base again.
  ["src/components/common/Layout.jsx", `import BarModeButton from "./BarModeButton";                                             // BAR MODE BUTTON (above Warehouse Mode)\n`, null],
  ["src/components/common/Layout.jsx", `        {/* BAR MODE BUTTON: above Warehouse Mode; renders NOTHING unless /bar/mine lists a bar. */}
        <BarModeButton compact={collapsed} wrapStyle={{ padding: collapsed ? "8px 6px 0" : "8px 12px 0" }} />\n`, null],
  ["src/components/layout/NavDrawer.jsx", `import BarModeButton from "../common/BarModeButton"; // BAR MODE BUTTON (above Warehouse Mode)\n`, null],
  ["src/components/layout/NavDrawer.jsx", `              {/* BAR MODE BUTTON: above Warehouse Mode; renders NOTHING unless /bar/mine lists a bar. */}
              <BarModeButton onNavigate={onClose} wrapStyle={{ marginTop: 12 }} />\n`, null],
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
