// A selectable option (title + description) for the resolve / variance / hold
// modals. It exists because a <button> does NOT inherit the page text colour: the
// browser default is black, so every hand-rolled option whose title set no colour
// rendered near-black on the dark sheet ("Which number is wrong?", the transfer
// variance reasons). Colours are explicit here and checked against --bg-surface
// (#1a1928): title --text-primary ≈ 16:1, selected title --brand ≈ 11:1,
// description --text-secondary ≈ 6.7:1 (WCAG AA needs 4.5:1). --text-muted
// (≈ 3.3:1) is deliberately NOT used for the description.
export default function OptionCard({ selected, onClick, disabled, title, hint, children, testId }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!selected} data-testid={testId}
      style={{ textAlign: "left", padding: "9px 11px", borderRadius: 10, cursor: disabled ? "default" : "pointer",
               width: "100%", color: "var(--text-primary)", font: "inherit",
               background: selected ? "rgba(251,197,3,0.10)" : "transparent",
               border: `1px solid ${selected ? "var(--brand)" : "var(--border-hover, rgba(255,255,255,0.16))"}` }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: selected ? "var(--brand)" : "var(--text-primary)" }}>
        {selected ? "● " : ""}{title}
      </div>
      {hint && <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.45 }}>{hint}</div>}
      {children}
    </button>
  );
}
