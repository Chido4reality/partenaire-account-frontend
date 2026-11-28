// MP-MOBILE-UI-PHASE-2A: morph wrapper around the existing Confirm
// button in POSPage's payment form. Drives its visual state reactively
// from saleMutation status — no change to the mutation itself.
//
//   idle    → renders `label`; click fires `onClick` (= attemptCheckout)
//   loading → "⏳ Saving… / Enregistrement…"; disabled
//   success → green ✓ Sold! + medium haptic; after 1200ms calls
//             `onSuccessTimeout` so the parent can collapse the
//             mobile cart sheet and reset visual state
//   error   → brief horizontal shake + light haptic; auto-returns
//             to idle after 1500ms (mutation.reset is fired by the
//             existing onError path in POSPage)
//
// INSTANT TAP (Peter 2026-11-28: staff never double-tap or wait on a frozen screen): the button locks ON THE TAP,
// not when the request has started — a ref blocks a second tap even within the same frame, and "Saving…" shows at
// once. It used to switch to loading in an effect AFTER the paint, and New Sale awaits a stock refresh before the
// sale is sent: in both gaps the button still said "✓ Confirm" and took a second tap = a second sale (each request
// carries its own local_id). onClick returns true when it started the sale; anything else (a stock warning, a
// validation message) unlocks the button at once.
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
  savingLabel = "Saving…",
  onSuccessTimeout,
  className = "btn btn-success",
  style = {},
}) {
  const [phase, setPhase] = useState("idle");
  const [armed, setArmed] = useState(false);   // tapped: locked until the sale settles (or never started)
  const armedRef = useRef(false);
  const timerRef = useRef(null);
  const disarm = () => { armedRef.current = false; setArmed(false); };

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
      disarm();
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
      disarm();
      setPhase("error");
      tapHaptic("light");
      timerRef.current = setTimeout(() => setPhase("idle"), 1500);
      return clearTimer;
    }
    clearTimer();
    setPhase("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleMutation.isPending, saleMutation.isSuccess, saleMutation.isError]);

  const shown = armed && phase !== "success" && phase !== "error" ? "loading" : phase;

  const handleTap = async () => {
    if (armedRef.current || shown !== "idle") return;   // a second tap — even in the same frame — does nothing
    armedRef.current = true;
    setArmed(true);
    let started = false;
    try { started = (await onClick?.()) === true; }
    catch (e) { started = false; }
    if (!started) disarm();   // no sale was sent (a modal, a message): the button is usable again
  };

  // Visual overrides per phase. Stays in the existing .btn-success
  // skin for idle so we don't drift from the rest of the form.
  const overrides = shown === "success"
    ? { background: "#10b981", borderColor: "#10b981", color: "#fff" }
    : shown === "error"
    ? { background: "#ef4444", borderColor: "#ef4444", color: "#fff" }
    : {};

  const content = shown === "loading" ? `⏳ ${savingLabel}`
                : shown === "success" ? (successLabel || "✓ Sold!")
                : shown === "error"   ? (errorLabel   || "✕ Failed")
                : label;

  return (
    <motion.button
      type="button"
      onClick={shown === "idle" ? handleTap : undefined}
      disabled={disabled || shown !== "idle"}
      aria-busy={shown === "loading" ? "true" : undefined}
      data-phase={shown}
      title={title}
      className={className}
      style={{ ...style, ...overrides, transition: "background 0.25s, color 0.25s, border-color 0.25s" }}
      animate={shown === "error" ? { x: [-6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.32 }}
    >
      {content}
    </motion.button>
  );
}
