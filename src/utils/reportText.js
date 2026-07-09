// MP-REPORT-SIMPLIFY-AND-AUTOSEND: shared plain-text builders for
// the daily ledger + weekly summary. Used by the Ledger tab
// (clipboard / print / WhatsApp buttons in ReportsPage) AND the
// shift-close trigger (SendReportPromptModal in ShiftWidgets).
// Centralising here keeps both surfaces byte-identical — what the
// boss receives must match what the cashier sees on screen.
//
// Math rules (simplified for non-technical readers):
//   Amount sold          = product_sales.total           (book value)
//   Debt collected       = debt_collections.total        (book value)
//   Total money received = Amount sold + Debt collected  (book value)
//   Counted in drawer    = drawer.actual                 (when shift closed)
//   Lost (drawer short)  = |variance| when variance < 0; omit at 0
//   Drawer surplus       = +variance when variance > 0; omit at 0
//   Expenses             = expenses.total                (today)
//   Cash at hand         = drawer.actual − expenses.total
//   Debt issued          = totals.impaye_aujourdhui      (today open balance)

import { useAuthStore } from "../store";
import { currencySymbol } from "./currency";
import { momoLabelShort } from "./paymentLabels";

const fmt = (x, en) => Number(x || 0).toLocaleString(en ? "en-US" : "fr-FR");

// MP-REFUNDS-LIST-TYPED-LABELS — primary kind label per pa_returns
// classification (kind field added server-side in /daily-ledger).
// Secondary modifier "credit split" appended by the caller when
// has_credit_split is true. The compact form ("credit split") is for
// WhatsApp; the in-app uses the longer "with credit split".
export function refundKindLabel(kind, lang) {
  const en = lang === "en";
  switch (kind) {
    case "void_refund":     return en ? "Void refund"             : "Annulation remboursée";
    case "refund_full":     return en ? "Refund (full)"           : "Remboursement (total)";
    case "refund_partial":  return en ? "Refund (partial)"        : "Remboursement (partiel)";
    case "exchange_same":   return en ? "Exchange (same item)"    : "Échange (même article)";
    case "exchange_diff":   return en ? "Exchange (different item)" : "Échange (article différent)";
    default:                return en ? "Refund"                  : "Remboursement";
  }
}

// "RET-20260523-0009" → "RET-0009" (last segment) for compact display.
export function shortRetRef(ref) {
  if (!ref) return "";
  const m = /-(\d+)$/.exec(String(ref));
  return m ? `RET-${m[1]}` : String(ref);
}

export function buildLedgerText(ledger, lang) {
  if (!ledger) return "";
  const currency = useAuthStore.getState().org?.currency;
  const sym = currencySymbol(currency);
  const en   = lang === "en";
  const n    = (x) => fmt(x, en);
  const ps   = ledger.product_sales    || { total: 0, items: [] };
  const dc   = ledger.debt_collections || { total: 0, items: [] };
  const ex   = ledger.expenses         || { total: 0, items: [] };
  const dr   = ledger.drawer || null;
  const tot  = ledger.totals || {};
  const locName  = ledger.location ? ledger.location.name : (en ? "all locations" : "tous les sites");
  const longDate = new Date(ledger.date + "T00:00:00").toLocaleDateString(en ? "en-GB" : "fr-FR",
    { day: "numeric", month: "long", year: "numeric" });

  const totalReceived = (Number(ps.total) || 0) + (Number(dc.total) || 0);
  const debtIssued    = Number(tot.impaye_aujourdhui || 0);
  const drCounted     = dr && dr.actual != null ? Number(dr.actual) : null;
  const drVariance    = dr && dr.variance != null ? Number(dr.variance) : null;
  const cashAtHand    = drCounted != null ? drCounted - Number(ex.total || 0) : null;

  const L = [];
  L.push(`*${en ? "DAILY REPORT" : "RAPPORT DU JOUR"} — ${locName}*`);
  L.push(`${longDate}${dr?.cashier_name ? " — " + dr.cashier_name : ""}`);
  L.push("");
  L.push(`${en ? "Amount sold"    : "Ventes du jour"}: ${n(ps.total)} ${sym}`);
  L.push(`${en ? "Debt collected" : "Dette encaissée"}: ${n(dc.total)} ${sym}`);
  L.push("─────────────────────────");
  L.push(`*${en ? "Total money received" : "Total reçu"}: ${n(totalReceived)} ${sym}*`);

  if (drCounted != null) {
    L.push("");
    L.push(`${en ? "Counted in drawer" : "Caisse comptée"}: ${n(drCounted)} ${sym}`);
    if (drVariance != null && drVariance < 0) {
      L.push(`${en ? "Lost (drawer short)" : "Manquant"}: ${n(Math.abs(drVariance))} ${sym}`);
    } else if (drVariance != null && drVariance > 0) {
      L.push(`${en ? "Drawer surplus" : "Excédent caisse"}: +${n(drVariance)} ${sym}`);
    }
    if (Number(ex.total) > 0) {
      L.push(`${en ? "Expenses" : "Dépenses"}: ${n(ex.total)} ${sym}`);
    }
    L.push("─────────────────────────");
    L.push(`*${en ? "Cash at hand" : "Cash en main"}: ${n(cashAtHand)} ${sym}*`);
  } else if (dr) {
    L.push("");
    L.push(en ? "Drawer not counted yet — shift still open" : "Caisse non comptée — poste encore ouvert");
    if (Number(ex.total) > 0) {
      L.push(`${en ? "Expenses today" : "Dépenses du jour"}: ${n(ex.total)} ${sym}`);
    }
  }

  if (debtIssued > 0) {
    L.push("");
    L.push(`${en ? "Debt issued (on credit)" : "Crédit du jour"}: ${n(debtIssued)} ${sym}`);
  }

  L.push("");
  L.push("— Mon Partenaire Dozie POS");
  return L.join("\n");
}

// MP-DAILY-REPORT-PROFESSIONAL-REDESIGN — three-block boss-facing
// daily report. Reads ledger.blocks (new field from /daily-ledger)
// and falls back to buildLedgerText if the field isn't present so a
// stale frontend against a fresh backend or vice-versa stays readable.
//
// Block 1 Day Flow      — sales / debt collected / refunds / expenses
//                         / net cash flow, with method splits
// Block 2 Shifts        — one block per shift (drawer-grade breakdown)
// Block 3 Outstanding   — today's new debt + all-time customer debt
//
// Localisation parallels buildLedgerText.
export function buildLedgerTextV2(ledger, lang) {
  if (!ledger) return "";
  if (!ledger.blocks) return buildLedgerText(ledger, lang); // back-compat
  const currency = useAuthStore.getState().org?.currency;
  const sym = currencySymbol(currency);
  const en = lang === "en";
  const n  = (x) => fmt(x, en);
  const b  = ledger.blocks;
  const df = b.day_flow      || {};
  const sh = b.shifts        || [];
  const ou = b.outstanding   || {};
  const dr = b.drawer        || {};   // TASK 3 drawer reconciliation
  const sales = df.sales          || {};
  const dcol  = df.debt_collected || {};
  const locName  = ledger.location ? ledger.location.name : (en ? "all locations" : "tous les sites");
  const longDate = new Date(ledger.date + "T00:00:00").toLocaleDateString(en ? "en-GB" : "fr-FR",
    { day: "numeric", month: "long", year: "numeric" });
  const tfmt = (iso) => iso
    ? new Date(iso).toLocaleTimeString(en ? "en-GB" : "fr-FR",
        { hour: "2-digit", minute: "2-digit" })
    : "—";

  const L = [];
  L.push(`*${en ? "DAILY REPORT" : "RAPPORT DU JOUR"} — ${locName}*`);
  L.push(longDate);
  L.push("");

  // ── BLOCK 1 — DAY FLOW ──────────────────────────────────────
  L.push(`*1. ${en ? "DAY FLOW" : "MOUVEMENT DU JOUR"}*`);
  L.push(`${en ? "Sales today" : "Ventes du jour"}: ${n(sales.total)} ${sym}`);
  L.push(`  • ${en ? "Paid cash" : "Payé espèces"}: ${n(sales.paid_cash)} ${sym}`);
  L.push(`  • ${en ? "Paid " : "Payé "}${momoLabelShort(currency, en)}: ${n(sales.paid_momo)} ${sym}`);
  L.push(`  • ${en ? "Paid bank" : "Payé banque"}: ${n(sales.paid_bank)} ${sym}`);
  L.push(`  • ${en ? "On credit" : "À crédit"}: ${n(sales.on_credit)} ${sym}`);
  L.push("");
  L.push(`${en ? "Debt collected" : "Dette encaissée"}: ${n(dcol.total)} ${sym}`);
  L.push(`  • ${en ? "Cash" : "Espèces"}: ${n(dcol.cash)} ${sym}`);
  L.push(`  • ${momoLabelShort(currency, en)}: ${n(dcol.momo)} ${sym}`);
  L.push(`  • ${en ? "Bank" : "Banque"}: ${n(dcol.bank)} ${sym}`);
  L.push("");
  // MP-VOID-PHYSICS: both void legs explicit — cash-in on voided sales (+) and the
  // refunds/voids paid out (−). Never silently netted; amounts from real rows.
  if (Number(dr.cash_received_on_voided_sales) > 0)
    L.push(`${en ? "Cash received on voided sales" : "Espèces reçues sur ventes annulées"}: +${n(dr.cash_received_on_voided_sales)} ${sym}`);
  L.push(`${en ? "Refunds & voids paid out" : "Remboursements & annulations décaissés"}: -${n(df.refunds_voids_cash_out)} ${sym}`);
  // MP-EXCHANGE-VISIBILITY: swaps as their own line with net effect.
  const ex = df.exchanges || {};
  if (ex.count) {
    const sgn = ex.net > 0 ? "+" : ex.net < 0 ? "−" : "";
    L.push(`${en ? "Exchanges" : "Échanges"} (${ex.count}): ${en ? "net" : "net"} ${sgn}${n(Math.abs(ex.net || 0))} ${sym}`);
    if (ex.cash_in)  L.push(`  • ${en ? "Customer paid in" : "Client a payé"}: +${n(ex.cash_in)} ${sym}`);
    if (ex.cash_out) L.push(`  • ${en ? "Refunded out" : "Remboursé"}: −${n(ex.cash_out)} ${sym}`);
  }
  L.push(`${en ? "Expenses" : "Dépenses"}: ${n(df.expenses)} ${sym}`);
  L.push("─────────────────────────");
  L.push(`*${en ? "Net cash flow" : "Flux net espèces"}: ${n(df.net_cash_flow)} ${sym}*`);
  L.push("");

  // ── BLOCK 2 — SHIFTS ────────────────────────────────────────
  L.push(`*2. ${en ? "SHIFTS" : "POSTES"}*`);
  if (!sh.length) {
    L.push(en ? "No shift opened today." : "Aucun poste ouvert aujourd'hui.");
  } else {
    sh.forEach((s, i) => {
      const closed = !!s.closed_at;
      const head = `${s.cashier_name || "—"}${s.location_name ? " · " + s.location_name : ""}` +
                   ` (${tfmt(s.opened_at)} → ${closed ? tfmt(s.closed_at) : (en ? "open" : "ouvert")})`;
      L.push(`▸ ${en ? "Shift" : "Poste"} ${i + 1}: ${head}`);
      L.push(`  ${en ? "Opening float" : "Fond d'ouverture"}: ${n(s.opening_float)} ${sym}`);
      L.push(`  ${en ? "Cash sales" : "Ventes espèces"}: ${n(s.cash_sales)} ${sym}`);
      L.push(`  ${en ? "Debt collected (cash)" : "Dette encaissée (espèces)"}: ${n(s.debt_collected_cash)} ${sym}`);
      L.push(`  ${en ? "Cash refunds" : "Remboursements espèces"}: ${n(s.cash_refunds)} ${sym}`);
      if (s.exchange_cash_in || s.exchange_cash_out) {
        L.push(`  ${en ? "Exchanges (in / out)" : "Échanges (entrée / sortie)"}: +${n(s.exchange_cash_in || 0)} / −${n(s.exchange_cash_out || 0)} ${sym}`);
      }
      L.push(`  ${en ? "Expenses" : "Dépenses"}: ${n(s.expenses)} ${sym}`);
      L.push(`  ${en ? "Expected drawer" : "Caisse attendue"}: ${n(s.expected_drawer)} ${sym}`);
      if (closed && s.counted_at_close != null) {
        L.push(`  ${en ? "Counted at close" : "Comptée à la clôture"}: ${n(s.counted_at_close)} ${sym}`);
        if (s.variance != null) {
          if (s.variance < 0) {
            L.push(`  ${en ? "Variance (short)" : "Écart (manquant)"}: −${n(Math.abs(s.variance))} ${sym}`);
          } else if (s.variance > 0) {
            L.push(`  ${en ? "Variance (surplus)" : "Écart (excédent)"}: +${n(s.variance)} ${sym}`);
          } else {
            L.push(`  ${en ? "Variance" : "Écart"}: 0 ${sym}`);
          }
        }
      } else {
        L.push(`  ${en ? "Status" : "Statut"}: ${en ? "open — not yet counted" : "ouvert — pas encore compté"}`);
      }
      if (i < sh.length - 1) L.push("");
    });
  }
  L.push("");

  // ── DRAWER — Expected drawer / variance / unattributed cash (TASK 3) ─────────
  if (b.drawer) {
    L.push(`*${en ? "DRAWER" : "CAISSE"}*`);
    L.push(`${en ? "Expected drawer" : "Caisse attendue"}: ${n(dr.expected_drawer)} ${sym}`);
    if (dr.drawer_variance != null) {
      const v = Number(dr.drawer_variance) || 0;
      // Sign shown here; the in-app renderer colours it red when non-zero.
      const line = `${en ? "Drawer variance" : "Écart de caisse"}: ${v > 0 ? "+" : v < 0 ? "-" : ""}${n(Math.abs(v))} ${sym}`;
      L.push(v !== 0 ? `${line} ⚠` : line);
    }
    // Unattributed cash hidden when 0 (approved).
    if (Number(dr.unattributed_cash) > 0)
      L.push(`${en ? "Unattributed cash (no shift)" : "Espèces hors caisse (sans quart)"}: ${n(dr.unattributed_cash)} ${sym}`);
    if (dr.reconciliation_warning)
      L.push(`⚠ ${en ? "Reconciliation" : "Rapprochement"}: ${dr.reconciliation_warning}`);
    L.push("");
  }

  // ── BLOCK 3 — OUTSTANDING ───────────────────────────────────
  L.push(`*3. ${en ? "OUTSTANDING" : "EN SUSPENS"}*`);
  L.push(`${en ? "Debt issued today" : "Crédit accordé aujourd'hui"}: ${n(ou.debt_issued_today)} ${sym}`);
  L.push(`${en ? "Total customer debt (all time)" : "Dette client totale (tous comptes)"}: ${n(ou.total_customer_debt_all_time)} ${sym}`);

  // ── REFUNDS DETAIL — typed list, compact form (only when any) ───
  //   MP-REFUNDS-LIST-TYPED-LABELS. Each row carries its kind label
  //   (refund/exchange/void) + credit-split modifier when present.
  //   Skip entirely when no refunds so quiet days aren't padded.
  const refs = ledger.refunds?.items || [];
  if (refs.length) {
    L.push("");
    L.push(`*${en ? "REFUNDS TODAY" : "REMBOURSEMENTS DU JOUR"}*`);
    refs.forEach(r => {
      const label = refundKindLabel(r.kind, lang);
      const modif = r.has_credit_split
        ? (en ? " · credit split" : " · split crédit")
        : "";
      L.push(`${shortRetRef(r.ret_ref)}  ${label}${modif}`);
      const who   = r.customer_name || (en ? "Walk-in" : "Client occasionnel");
      const what  = r.items_summary || "—";
      L.push(`  ${who} · ${what}`);
      if (r.kind === "exchange_diff" && Number(r.price_difference)) {
        const pd = Number(r.price_difference);
        const pdLine = pd > 0
          ? (en ? `+${n(pd)} cash back to customer` : `+${n(pd)} rendu au client`)
          : (en ? `${n(pd)} customer paid`          : `${n(pd)} payé par le client`);
        L.push(`  ${pdLine}`);
      }
      const amt = Number(r.refund_amount) || 0;
      let amtLine = `  -${n(amt)} ${sym}`;
      if (r.has_credit_split) {
        amtLine += en
          ? ` (${n(r.credit_portion)} credit / ${n(r.cash_portion)} cash)`
          : ` (${n(r.credit_portion)} crédit / ${n(r.cash_portion)} cash)`;
      }
      L.push(amtLine);
      if (r.reason) L.push(`  ${en ? "Reason" : "Motif"}: ${r.reason}`);
    });
  }

  L.push("");
  L.push("— Mon Partenaire Dozie POS");
  return L.join("\n");
}

// Weekly section appended on Saturdays (or whenever weekly data is
// available). Best-X lines are skipped when null so quiet weeks
// don't get empty bullets in the message.
export function buildWeeklyText(w, lang) {
  if (!w) return "";
  const currency = useAuthStore.getState().org?.currency;
  const sym = currencySymbol(currency);
  const en = lang === "en";
  const n  = (x) => fmt(x, en);
  const dfmt = (d) => new Date(d + "T00:00:00").toLocaleDateString(en ? "en-GB" : "fr-FR",
    { day: "numeric", month: "short" });
  const L = [];
  L.push("");
  L.push("────────────────────────");
  L.push(`*${en ? "WEEKLY SUMMARY" : "RÉSUMÉ DE LA SEMAINE"} (${dfmt(w.week_start)} – ${dfmt(w.week_end)})*`);
  L.push("");
  L.push(`${en ? "Total sales"     : "Total ventes"}: ${n(w.total_sales)} ${sym}`);
  L.push(`${en ? "Total refunds"   : "Total remboursements"}: ${n(w.total_refunds)} ${sym}`);
  L.push(`${en ? "Cash in (real)"  : "Argent reçu (réel)"}: ${n(w.cash_in_real)} ${sym}`);
  L.push(`${en ? "New debt issued" : "Crédit accordé"}: ${n(w.new_debt_issued)} ${sym}`);
  if (w.best_customer) {
    L.push("");
    L.push(en ? "Best customer this week" : "Meilleur client de la semaine");
    L.push(`  ${w.best_customer.customer_name} — ${n(w.best_customer.total_paid)} ${sym} ${en ? "paid" : "payé"}`);
  }
  if (w.best_product) {
    L.push("");
    L.push(en ? "Best-selling product" : "Meilleur produit");
    L.push(`  ${w.best_product.product_name} — ${w.best_product.total_qty} ${en ? "units sold" : "unités vendues"}`);
  }
  if (w.highest_expense) {
    L.push("");
    L.push(en ? "Highest expense" : "Dépense la plus élevée");
    L.push(`  ${w.highest_expense.description || w.highest_expense.category || "?"} — ${n(w.highest_expense.amount)} ${sym}${w.highest_expense.date ? " (" + dfmt(w.highest_expense.date) + ")" : ""}`);
  }
  if (w.trend_pct != null) {
    const sign = w.trend_pct > 0 ? "📈" : w.trend_pct < 0 ? "📉" : "➡";
    const pct  = (w.trend_pct >= 0 ? "+" : "") + Math.round(w.trend_pct) + "%";
    L.push("");
    L.push(`${sign} ${en ? "vs last week" : "vs semaine dernière"}: ${pct}`);
  }
  return L.join("\n");
}
