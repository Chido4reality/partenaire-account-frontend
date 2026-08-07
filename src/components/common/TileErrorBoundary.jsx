import { Component } from "react";

// ── MP-TILE-ISOLATION (2026-08-07) ──────────────────────────────────────────
// WHY THIS EXISTS. The app had exactly ONE ErrorBoundary (App.jsx), wrapping
// everything and rendering a full-screen height:100vh "Something went wrong". So a
// throw inside any single dashboard card blanked the ENTIRE app — including the
// POS. A shopkeeper mid-sale lost the till because a summary tile he was not even
// looking at failed to render.
//
// That is the wrong failure mode regardless of what caused any particular crash.
// It is worth fixing on its own merits even now that the translate crash
// (MP-TRANSLATE-CRASH) has a root cause and a fix: the next unrelated bug in any
// tile should cost that tile, not the ability to take money.
//
// DELIBERATELY NOT a copy of the app-level boundary. This one:
//   • renders INLINE, at the tile's own size — never full-screen, so a broken tile
//     cannot visually masquerade as a broken app;
//   • keeps the rest of the dashboard interactive;
//   • offers a local retry, because most render crashes are transient (a bad
//     intermediate value, a race with a refetch) and a reload costs a shopkeeper
//     on a slow Cameroonian link far more than a button does;
//   • still console.errors with the tile's name, so the app-level logging that
//     surfaced the removeChild trace keeps working.
//
// Error boundaries catch RENDER errors only — not event handlers, not async
// rejections, not errors thrown inside a setTimeout. It is not a general safety
// net and must not be treated as one.
export default class TileErrorBoundary extends Component {
  state = { crashed: false, error: null };

  static getDerivedStateFromError(error) { return { crashed: true, error }; }

  componentDidCatch(error, info) {
    console.error(`[TileErrorBoundary:${this.props.name || "tile"}]`, error, info);
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const fr = this.props.fr;
    return (
      <div style={{
        background: "var(--bg-card)", border: "1px solid rgba(248,113,113,0.35)",
        borderRadius: 14, padding: "12px 14px", width: "100%", maxWidth: 560,
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {fr ? "Cette carte n'a pas pu s'afficher" : "This card could not load"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
            {fr ? "Le reste de l'application fonctionne normalement."
                : "The rest of the app is working normally."}
          </div>
        </div>
        <button
          onClick={() => this.setState({ crashed: false, error: null })}
          style={{
            padding: "5px 11px", borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
          }}>
          {fr ? "Réessayer" : "Retry"}
        </button>
      </div>
    );
  }
}
