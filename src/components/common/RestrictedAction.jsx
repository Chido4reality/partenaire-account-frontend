// MP-TRIAL-EXPIRY-RESTRICTION (UI polish) — wrap any create/write control so it
// appears VISIBLY DISABLED for a restricted (trial-ended) org and, on tap, routes
// to /request-activation instead of firing the action. View controls are never
// wrapped. The server-side blockIfRestricted 403 stays the safety net — this is
// additive UI only.
//
// HOW: when restricted, the child keeps its own markup but gets pointer-events:none
// (its onClick can never fire) + greyed; the wrapper span catches the click and
// redirects. When NOT restricted, children render untouched (zero overhead).
//
// Usage: <RestrictedAction><button onClick={charge}>Pay</button></RestrictedAction>
//        <RestrictedAction block>…full-width button…</RestrictedAction>
import { useNavigate } from "react-router-dom";
import { useRestricted } from "../../hooks/useRestricted";

export default function RestrictedAction({ children, block = false, style }) {
  const { restricted, hint } = useRestricted();
  const navigate = useNavigate();
  if (!restricted) return children;
  return (
    <span
      title={hint}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate("/request-activation"); }}
      style={{ display: block ? "block" : "inline-block", width: block ? "100%" : undefined, cursor: "not-allowed", ...style }}
    >
      <span style={{ pointerEvents: "none", opacity: 0.5, display: block ? "block" : undefined }}>
        {children}
      </span>
    </span>
  );
}
