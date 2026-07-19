// MP-HELP v1 — per-screen "?" entry point. A small circular help icon placed in a
// screen's header; tapping it opens the in-app guide anchored to that screen's topic
// (/help#<topic>), so a stuck user gets help right there without hunting the sidebar.
// The sidebar Help/Aide item still works too — both ways in.
import { useNavigate } from "react-router-dom";

export default function HelpButton({ topic, title, style }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-label="Help"
      title={title || "Help / Aide"}
      onClick={(e) => { e.stopPropagation(); navigate(`/help${topic ? `#${topic}` : ""}`); }}
      style={{
        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
        border: "1px solid var(--border)", background: "var(--bg-elevated)",
        color: "var(--text-muted)", cursor: "pointer",
        fontWeight: 800, fontSize: 15, lineHeight: 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        ...style,
      }}
    >
      ?
    </button>
  );
}
