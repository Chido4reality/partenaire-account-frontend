// ── SUPPORT CONTACT — ONE DEFINITION ────────────────────────────────────────
//
// WHY THIS FILE EXISTS. The support number was previously written out in six
// places (Layout, NavDrawer, PaywallModal, HelpPage x2, RequestActivationPage)
// plus two static HTML pages and the marketing site — in FOUR different string
// formats for the same number:
//     237621840952        bare, for wa.me
//     +237621840952       for tel:
//     +237 621 840 952    displayed, 3-3-3
//     +237 621 84 09 52   displayed, 2-2-2-2
// A find-and-replace on any one of those catches roughly half the occurrences and
// leaves the rest pointing at a retired line. That is the whole reason this is a
// module and not a string.
//
// ⚠️ ADD NO SECOND NUMBER HERE. Support was previously routed per country
// (Cameroon vs Nigeria) but only the Help page ever honoured it — the sidebar, the
// mobile drawer and the paywall all hardcoded the Cameroon line, so Nigerian users
// reached it anyway. Both numbers are now retired in favour of ONE line, which is
// why supportForCountry() is gone rather than left as a dead branch.
//
// The three formats below are derived from a single source of truth so they cannot
// drift apart again.

// International, digits only. This is the wa.me path segment — wa.me REQUIRES no
// '+' and no spaces, so it must stay bare.
export const SUPPORT_PHONE = "46722865738";

// For tel: links — needs the leading '+', no spaces.
export const SUPPORT_TEL = `+${SUPPORT_PHONE}`;

// For anything a human READS. Swedish convention, applied consistently everywhere
// (it replaces both the old 3-3-3 and 2-2-2-2 conventions).
export const SUPPORT_DISPLAY = "+46 72 286 57 38";

export const SUPPORT_EMAIL = "support@partenairedozie.com";

// Convenience: a ready wa.me deep link with an optional prefilled message.
export const supportWaLink = (message) =>
  `https://wa.me/${SUPPORT_PHONE}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
