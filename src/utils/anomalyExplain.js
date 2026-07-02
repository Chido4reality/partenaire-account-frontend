// MP-ANOMALY-EXPLAIN — ONE shared mapper that turns a HIGH/MEDIUM-risk staff
// action (a pa_audit_log row: action + rich new_data) into three dead-simple,
// plain-language lines — WHAT HAPPENED / WHY IT'S FLAGGED / WHAT TO DO — in the
// app language (English primary, French secondary), with a jargon-free severity
// cue. Used by the Operations Anomalies feed, the notification bell, AND the
// Accountant Log so all three read IDENTICALLY.
//
// It re-derives everything from the payload AT DISPLAY TIME, so it works for the
// alerts already sitting in the feed — it does NOT depend on any newly-stored
// wording. It only renders data the audit row already has; it collects nothing.
//
//   audit : { action, new_data (jsonb object), actor_name? }
//   en    : boolean (true = English, false = French)
//   money : (n) => string  — the org currency formatter, e.g. fmt from
//           useCurrency() → "1 500 FCFA" / "1 500 ₦" (currency INCLUDED).

const HIGH = new Set([
  "sale_voided", "sale_voided_approval", "return_processed",
  "stock_adjusted_manually", "customer_debt_manual_adjustment", "customer_deleted",
]);
const MEDIUM = new Set(["credit_extended_in_sale"]);

// 'high' | 'medium' | 'low'
export function anomalySeverity(action) {
  if (HIGH.has(action)) return "high";
  if (MEDIUM.has(action)) return "medium";
  return "low";
}

// Plain-words severity cue (no jargon) + a coloured dot.
export function severityCue(severity, en) {
  if (severity === "high")
    return { level: "high", label: en ? "⚠️ Please check this" : "⚠️ À vérifier", dot: "#f87171" };
  // medium + low both read as "good to know" per the spec.
  return { level: severity === "medium" ? "medium" : "low", label: en ? "ℹ️ Good to know" : "ℹ️ Bon à savoir", dot: "#fbbf24" };
}

// Is this action one we have a full What/Why/Do script for?
export function hasExplanation(action) {
  return HIGH.has(action) || MEDIUM.has(action);
}

// One-line label for a COLLAPSED group of the same action (e.g. "cancelled 6
// sales") — used when the same staffer repeats an action many times in a day.
export function groupLabel(action, count, en) {
  switch (action) {
    case "sale_voided":
    case "sale_voided_approval":        return en ? `cancelled ${count} sales`       : `a annulé ${count} ventes`;
    case "return_processed":            return en ? `made ${count} refunds/returns`  : `a fait ${count} remboursements/retours`;
    case "stock_adjusted_manually":     return en ? `made ${count} stock changes`    : `a fait ${count} modifications de stock`;
    case "customer_debt_manual_adjustment": return en ? `made ${count} debt changes` : `a fait ${count} modifications de dette`;
    case "credit_extended_in_sale":     return en ? `gave credit ${count} times`     : `a accordé du crédit ${count} fois`;
    case "customer_deleted":            return en ? `deleted ${count} customers`     : `a supprimé ${count} clients`;
    default:                            return en ? `did ${count} actions`           : `a fait ${count} actions`;
  }
}

// Plain WHY / WHAT-TO-DO for the Operations Anomalies feed. Those items are
// COMPUTED clusters (by anomaly `kind`), not single audit rows, so they can't run
// explainAnomaly() — but they get the SAME plain-language tone + severity cue here.
const OPS = {
  drawer_variance: {
    en: { why: "The cash counted doesn't match what the app expected. Money may be missing or miscounted.", do: "Recount the drawer and ask the cashier about the difference." },
    fr: { why: "L'argent compté ne correspond pas à ce que l'app attendait. De l'argent peut manquer ou être mal compté.", do: "Recomptez la caisse et demandez au caissier la différence." },
  },
  large_sale: {
    en: { why: "A very large sale stands out. Usually fine, but worth a quick look.", do: "Confirm the sale and the payment are real." },
    fr: { why: "Une très grosse vente ressort. Souvent normal, mais à vérifier rapidement.", do: "Confirmez que la vente et le paiement sont réels." },
  },
  void_cluster: {
    en: { why: "Many cancellations in a short time can hide theft.", do: "Ask the cashier why so many sales were cancelled, and check the cash." },
    fr: { why: "Beaucoup d'annulations en peu de temps peuvent cacher un vol.", do: "Demandez au caissier pourquoi tant de ventes ont été annulées, et vérifiez la caisse." },
  },
  debt_accumulation: {
    en: { why: "One customer's credit keeps growing. Too much unpaid credit is risky.", do: "Check this customer can still pay, and consider pausing more credit." },
    fr: { why: "Le crédit d'un client ne cesse d'augmenter. Trop de crédit impayé est risqué.", do: "Vérifiez que ce client peut encore payer, et pensez à arrêter le crédit." },
  },
  large_stock_adjustment: {
    en: { why: "A big by-hand stock change can hide missing goods.", do: "Count the real stock and ask why it was changed." },
    fr: { why: "Une grosse modification de stock à la main peut cacher des marchandises manquantes.", do: "Comptez le stock réel et demandez pourquoi il a été modifié." },
  },
  void_after_payment: {
    en: { why: "A sale was cancelled AFTER it was paid — a common way to pocket cash.", do: "Check the cash for this receipt and confirm the customer was really refunded." },
    fr: { why: "Une vente a été annulée APRÈS avoir été payée — une manière courante de détourner l'argent.", do: "Vérifiez l'argent de ce reçu et confirmez que le client a bien été remboursé." },
  },
};

// { why, do } for an Operations anomaly `kind` ("" when we have no script).
export function opsAnomalyGuidance(kind, en) {
  const g = OPS[kind];
  if (!g) return { why: "", do: "" };
  return en ? g.en : g.fr;
}

// Operations severity string ('critical'|'warning'|'info') → the plain cue.
export function opsSeverityCue(severity, en) {
  const level = severity === "critical" ? "high" : severity === "warning" ? "medium" : "low";
  return severityCue(level, en);
}

// Returns { severity, what, why, do } — why/do are "" for actions without a
// dedicated script (what still renders a best-effort sentence).
export function explainAnomaly(audit, en, money) {
  const action = audit && audit.action;
  const d = (audit && audit.new_data) || {};
  const has = (v) => v != null && v !== "";
  const m = (v) => (money ? money(Math.abs(Number(v) || 0)) : String(Math.round(Math.abs(Number(v) || 0))));
  const actor = has(audit && audit.actor_name) ? audit.actor_name : (en ? "A staff member" : "Un employé");
  const severity = anomalySeverity(action);

  switch (action) {
    case "sale_voided":
    case "sale_voided_approval": {
      const by = has(d.voided_by_name) ? d.voided_by_name : actor;
      const num = has(d.sale_number) ? d.sale_number : (en ? "a sale" : "une vente");
      const amt = has(d.original_total_amount) ? m(d.original_total_amount) : "";
      const reason = has(d.reason) ? d.reason : (en ? "not given" : "non indiquée");
      const items = (Array.isArray(d.items_returned) ? d.items_returned : [])
        .map((it) => it && it.name).filter(Boolean).join(", ");
      const goods = items || (en ? "the goods" : "les articles");
      return {
        severity,
        what: en
          ? `${by} cancelled sale ${num}${amt ? ` worth ${amt}` : ""}. Reason: ${reason}.`
          : `${by} a annulé la vente ${num}${amt ? ` de ${amt}` : ""}. Raison : ${reason}.`,
        why: en
          ? "Cancelling a sale takes money out of the day's records. It can be normal, or it can hide theft."
          : "Annuler une vente retire de l'argent des comptes du jour. Ça peut être normal, ou cacher un vol.",
        do: en
          ? `Ask ${by} why. If a customer really returned ${goods}, it's fine. If not, check the cash — money may be missing.`
          : `Demandez à ${by} pourquoi. Si le client a vraiment rendu ${goods}, c'est bon. Sinon, vérifiez la caisse — de l'argent peut manquer.`,
      };
    }

    case "return_processed": {
      const num = has(d.sale_number) ? d.sale_number : (en ? "a sale" : "une vente");
      const amt = has(d.refund_amount) ? m(d.refund_amount) : "";
      const method = has(d.refund_method) ? ` (${d.refund_method})` : "";
      const isExchange = !(Number(d.refund_amount) > 0);
      return {
        severity,
        what: isExchange
          ? (en ? `${actor} did an exchange on sale ${num}.` : `${actor} a fait un échange sur la vente ${num}.`)
          : (en ? `${actor} refunded ${amt} on sale ${num}${method}.` : `${actor} a remboursé ${amt} sur la vente ${num}${method}.`),
        why: en
          ? "Refunds take money out. A fake refund is a common way to steal."
          : "Les remboursements retirent de l'argent. Un faux remboursement est une manière courante de voler.",
        do: en
          ? "Make sure the customer really returned the goods."
          : "Assurez-vous que le client a vraiment rendu la marchandise.",
      };
    }

    case "stock_adjusted_manually": {
      const prod = has(d.product_name) ? d.product_name : (has(d.name) ? d.name : (en ? "a product" : "un article"));
      const from = has(d.from_quantity) ? d.from_quantity : "?";
      const to = has(d.to_quantity) ? d.to_quantity : "?";
      return {
        severity,
        what: en
          ? `${actor} changed stock of ${prod} from ${from} to ${to}.`
          : `${actor} a changé le stock de ${prod} de ${from} à ${to}.`,
        why: en
          ? "Changing stock by hand can hide missing goods."
          : "Modifier le stock à la main peut cacher des marchandises manquantes.",
        do: en
          ? "Ask why, and count the real stock to confirm."
          : "Demandez pourquoi, et comptez le stock réel pour confirmer.",
      };
    }

    case "customer_debt_manual_adjustment": {
      const who = has(d.target_name) ? d.target_name : (has(d.customer_name) ? d.customer_name : (en ? "a customer" : "un client"));
      const delta = has(d.delta) ? m(d.delta) : "";
      const after = has(d.total_debt_after) ? m(d.total_debt_after) : (has(d.total_debt) ? m(d.total_debt) : "");
      return {
        severity,
        what: en
          ? `${actor} changed ${who}'s debt by ${delta}.${after ? ` New debt: ${after}.` : ""}`
          : `${actor} a modifié la dette de ${who} de ${delta}.${after ? ` Nouvelle dette : ${after}.` : ""}`,
        why: en
          ? "Lowering a debt by hand can hide money a customer still owes."
          : "Baisser une dette à la main peut cacher de l'argent qu'un client doit encore.",
        do: en
          ? "Confirm the customer really paid, or that the change is correct."
          : "Confirmez que le client a vraiment payé, ou que le changement est correct.",
      };
    }

    case "customer_deleted": {
      const who = has(d.target_name) ? d.target_name : (en ? "a customer" : "un client");
      const debt = has(d.total_debt) ? m(d.total_debt) : "";
      return {
        severity,
        what: en
          ? `${actor} deleted customer ${who}${debt ? `, who owed ${debt}` : ""}.`
          : `${actor} a supprimé le client ${who}${debt ? `, qui devait ${debt}` : ""}.`,
        why: en
          ? "Deleting a customer who owes money erases the debt."
          : "Supprimer un client qui doit de l'argent efface la dette.",
        do: en
          ? "If they still owe, this is serious — ask why they were removed."
          : "S'il doit encore, c'est grave — demandez pourquoi il a été supprimé.",
      };
    }

    case "credit_extended_in_sale": {
      const who = has(d.target_name) ? d.target_name : (en ? "a customer" : "un client");
      const ext = has(d.extended) ? m(d.extended) : "";
      return {
        severity,
        what: en
          ? `${actor} let ${who} take ${ext} on credit.`
          : `${actor} a laissé ${who} prendre ${ext} à crédit.`,
        why: en
          ? "Credit means money owed, not collected. Too much credit is risky."
          : "Le crédit, c'est de l'argent dû, pas encaissé. Trop de crédit est risqué.",
        do: en
          ? "Make sure this customer is trusted to pay."
          : "Assurez-vous que ce client est de confiance pour payer.",
      };
    }

    default: {
      // No dedicated script — render a best-effort "what" from the action name
      // and any obvious payload amount; leave why/do empty.
      const nice = String(action || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const amt = has(d.amount) ? ` — ${m(d.amount)}` : "";
      return { severity, what: `${actor} · ${nice}${amt}`, why: "", do: "" };
    }
  }
}
