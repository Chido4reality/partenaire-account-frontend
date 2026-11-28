// INSTANT TAP (Peter 2026-11-28: every pay / send / serve button reacts on the tap — disabled + "Saving…" — so staff
// never double-tap or wait on a frozen screen).
// React Query hands `isPending` to the screen on a later tick, so a button disabled by `mutation.isPending` alone can
// still take a second tap in between. useTapLock wraps a mutation: `fire(vars, opts)` locks ON THE TAP (a ref, so a
// second tap in the same frame does nothing) until that call settles; `busy` disables every button of that mutation;
// `savingFor(match)` says which button was tapped, so only that one reads "Saving…".
// Drop-in for `mutation.mutate`: same (variables, { onSuccess, onError, onSettled }) arguments.
import { useRef, useState } from "react";

export function useTapLock(mutation) {
  const lockRef = useRef(null);
  const [tapped, setTapped] = useState(null);
  const release = () => { lockRef.current = null; setTapped(null); };
  const fire = (vars, opts = {}) => {
    if (lockRef.current || mutation.isPending) return false;
    lockRef.current = vars || {};
    setTapped(vars || {});
    mutation.mutate(vars, {
      ...opts,
      onSettled: (...a) => { release(); if (opts.onSettled) opts.onSettled(...a); },
    });
    return true;
  };
  const busy = !!tapped || mutation.isPending;
  const savingFor = (match) => !!((tapped && match(tapped)) || (mutation.isPending && mutation.variables && match(mutation.variables)));
  // `mutate` / `isPending` let a child that was handed the raw mutation take the lock without changing its code
  return { fire, busy, savingFor, mutate: fire, isPending: busy };
}

export const savingText = (lang) => (lang === "en" ? "Saving…" : "Enregistrement…");
