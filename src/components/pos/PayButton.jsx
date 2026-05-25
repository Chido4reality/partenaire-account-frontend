// MP-MOBILE-UI-PHASE-2A: morph wrapper around the existing Confirm
// button in POSPage's payment form. Drives its visual state reactively
// from saleMutation status — no change to the mutation itself.
//
//   idle    → renders `label`; click fires `onClick` (= attemptCheckout)
//   loading → spinner glyph; disabled
//   success → green ✓ Sold! + medium haptic; after 1200ms calls
//             `onSuccessTimeout` so the parent can collapse the
//             mobile cart sheet and reset visual state
//   error   → brief horizontal shake + light haptic; auto-returns
//             to idle after 1500ms (mutation.reset is fired by the
//             existing onError path in POSPage)
import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { tapHaptic } from "../../utils/haptics";

export default function PayButton({
  saleMutation,
  onClick,
  disabled,
  title,
  label,
  successLabel,
  errorLabel,
  onSuccessTimeout,
  className = "btn btn-success",
  style = {},
}) {
  const [phase, setPhase] = useState("idle");
  const timerRef = useRef(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (saleMutation.isPending) {
      clearTimer();
      setPhase("loading");
      return;
    }
    if (saleMutation.isSuccess) {
      clearTimer();
      setPhase("success");
      tapHaptic("medium");
      timerRef.current = setTimeout(() => {
        setPhase("idle");
        onSuccessTimeout?.();
      }, 1200);
      return clearTimer;
    }
    if (saleMutation.isError) {
      clearTimer();
      setPhase("error");
      tapHaptic("light");
      timerRef.current = setTimeout(() => setPhase("idle"), 1500);
      return clearTimer;
    }
    clearTimer();
    setPhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleMutation.isPending, saleMutation.isSuccess, saleMutation.isError]);

  // Visual overrides per phase. Stays in the existing .btn-success
  // skin for idle so we don't drift from the rest of the form.
  const overrides = phase === "success"
    ? { background: "#10b981", borderColor: "#10b981", color: "#fff" }
    : phase === "error"
    ? { background: "#ef4444", borderColor: "#ef4444", color: "#fff" }
    : {};

  const content = phase === "loading" ? "⏳"
                : phase === "success" ? (successLabel || "✓ Sold!")
                : phase === "error"   ? (errorLabel   || "✕ Failed")
                : label;

  return (
    <motion.button
      type="button"
      onClick={phase === "idle" ? onClick : undefined}
      disabled={disabled || phase !== "idle"}
      title={title}
      className={className}
      style={{ ...style, ...overrides, transition: "background 0.25s, color 0.25s, border-color 0.25s" }}
      animate={phase === "error" ? { x: [-6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.32 }}
    >
      {content}
    </motion.button>
  );
}
