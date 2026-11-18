// BAR MODE BUTTON (Peter 2026-11-18): the big "Bar Mode" button at the top of the menu, ABOVE the
// Warehouse Mode button (desktop sidebar + phone drawer), same shape, its own colour. It replaces the
// plain "Bar" menu entry.
//
// Shown ONLY when GET /bar/mine lists a bar for this person. That request is made by Layout and only for
// a Pro Plus org that has not switched Bar Mode off, for owner / manager / cashier; this button never
// fetches (enabled: false) — it reads Layout's answer from the shared cache. No answer, no bar, an error,
// or Warehouse Mode (a selling screen) → it renders NOTHING (no wrapper either), so the menu of every
// other business is exactly what it was.
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../../utils/api";
import { useLangStore } from "../../store";
import { useWorkMode } from "../../utils/workMode";
import { useBarChrome } from "../../store/barChrome";

const AMBER = "#FF9F43";

export default function BarModeButton({ compact = false, onNavigate, wrapStyle }) {
  const { lang } = useLangStore();
  const en = lang === "en";
  const mode = useWorkMode();
  const navigate = useNavigate();
  const location = useLocation();
  // the SAME key and shape as Layout / BarPage (["bar-mine"] → { bars, … }); never fetched from here
  const { data } = useQuery({
    queryKey: ["bar-mine"], enabled: false, staleTime: 60000, retry: false,
    queryFn: () => api.get("/bar/mine").then((r) => r.data?.data || { bars: [] }),
  });
  if (mode === "warehouse" || !((data?.bars || []).length > 0)) return null;

  const here = location.pathname === "/bar";
  const label = en ? "Bar Mode" : "Mode Bar";
  const sub = here ? (en ? "You are in the bar" : "Vous êtes au bar") : (en ? "Tables, tabs and quick sell" : "Tables, notes et vente rapide");
  const onClick = () => {
    useBarChrome.getState().setMenuOpen(false);   // on /bar: closes the menu the bar's ☰ opened
    if (!here) navigate("/bar");
    if (onNavigate) onNavigate();
  };
  return (
    <div style={wrapStyle}>
    <button type="button" onClick={onClick} title={label} aria-label={label} aria-current={here ? "page" : undefined}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: compact ? "10px 0" : "11px 14px", justifyContent: compact ? "center" : "flex-start",
        borderRadius: 12, cursor: "pointer",
        border: `1.5px solid ${AMBER}`, background: here ? `${AMBER}40` : `${AMBER}1F`, color: AMBER,
        fontWeight: 800, fontSize: 14, textAlign: "left",
      }}>
      <span style={{ fontSize: 18 }}>🍺</span>
      {!compact && (
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span>{label}</span>
          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{sub}</span>
        </span>
      )}
    </button>
    </div>
  );
}
