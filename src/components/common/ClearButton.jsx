// MP-SEARCH-CLEAR-BUTTON
//
// One shared clear (×) affordance for every search field. Renders ONLY when the
// field has text. Tapping it:
//   • clears the text ONLY (calls onClear) — it does NOT close the results list
//     or dropdown, so the user can immediately retype (pairs with fast multi-add)
//   • keeps focus in the field — onMouseDown preventDefault stops the tap from
//     blurring the input (which is also what keeps blur-closed dropdowns open),
//     and we re-focus via inputRef as a belt-and-suspenders on touch WebViews.
//
// Place inside a position:relative container and give the input enough
// paddingRight (≈34) so text never runs under the ×. `right` offsets it so it
// can sit clear of an existing camera/scan icon without overlapping.
export default function ClearButton({ value, onClear, inputRef, right = 8, title = "Clear", size = 22 }) {
  if (value == null || value === "") return null;
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      // preventDefault keeps the input focused (no blur → dropdowns stay open).
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClear();
        // Re-assert focus so the user can type again right away.
        if (inputRef && inputRef.current) inputRef.current.focus();
      }}
      style={{
        position: "absolute",
        right,
        top: "50%",
        transform: "translateY(-50%)",
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        borderRadius: "50%",
        border: "none",
        background: "rgba(148,163,184,0.18)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        fontSize: 13,
        lineHeight: 1,
        zIndex: 3,
      }}
    >
      ✕
    </button>
  );
}
