// STENAMO-RECEIPTS (20261017m): Settings → Subscription → Receipts / Reçus.
// The server decides who may see receipts (owner; a manager only when the owner allows) — a 403
// hides the card instead of showing an empty list. Receipts are issued by the server when a
// payment is confirmed and are never edited; a correction appears as a credit note (avoir).
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "../../utils/api";
import { openWhatsApp } from "../../utils/whatsapp";

const API_BASE = import.meta.env.VITE_API_URL || "/api";
const fmtDate = (d) => { if (!d) return "—"; const [y, m, day] = String(d).slice(0, 10).split("-"); return `${day}/${m}/${y}`; };
const fmtMoney = (n, cur, en) => `${Math.round(Number(n) || 0).toLocaleString(en ? "en-US" : "fr-FR").replace(/ /g, " ")} ${cur}`;
const METHOD = { flutterwave: "Flutterwave", campay: "Mobile Money", momo: "Mobile Money", mtn_momo: "MTN MoMo",
  orange_money: "Orange Money", mobile_money: "Mobile Money", bank: null, cash: null };
const methodLabel = (m, en) => m === "cash" ? (en ? "Cash" : "Espèces") : m === "bank" ? (en ? "Bank" : "Virement") : (METHOD[m] || m || "—");

async function blobToBase64(blob) {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = bad; r.readAsDataURL(blob); });
}

export default function SubscriptionReceiptsCard({ lang }) {
  const en = lang === "en", qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  const q = useQuery({
    queryKey: ["subscription-receipts"],
    queryFn: async () => (await api.get("/subscriptions/receipts")).data,
    retry: (n, e) => e?.response?.status !== 403 && n < 2,
  });
  const toggle = useMutation({
    mutationFn: (allowed) => api.put("/subscriptions/receipts/settings", { managers_allowed: allowed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscription-receipts"] }),
    onError: () => toast.error(en ? "Could not save" : "Échec de l'enregistrement"),
  });

  if (q.isError && q.error?.response?.status === 403) return null;      // not for this role
  const rows = q.data?.data || [];

  const download = async (r) => {
    setBusy(r.id);
    try {
      const res = await api.get(`/subscriptions/receipts/${r.id}/pdf`, { params: { lang: en ? "en" : "fr" }, responseType: "blob", timeout: 20000 });
      const filename = `${r.receipt_number}.pdf`;
      let isNative = false;
      try { const { Capacitor } = await import("@capacitor/core"); isNative = Capacitor.isNativePlatform(); } catch { /* web */ }
      if (isNative) {
        const { Filesystem, Directory } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({ path: filename, data: await blobToBase64(res.data), directory: Directory.Cache });
        const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        const { Share } = await import("@capacitor/share");
        await Share.share({ title: filename, files: [uri], dialogTitle: en ? "Save / share receipt" : "Enregistrer / partager le reçu" });
      } else {
        const url = URL.createObjectURL(res.data), a = document.createElement("a");
        a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch {
      toast.error(en ? "Could not download the receipt" : "Impossible de télécharger le reçu");
    } finally { setBusy(null); }
  };

  const share = (e, r) => {
    const link = new URL(`${API_BASE}${r.share_path}?lang=${en ? "en" : "fr"}`, window.location.origin).href;
    const title = r.kind === "credit_note" ? (en ? "Credit note" : "Avoir") : (en ? "Receipt" : "Reçu");
    const text = [
      `Stenamo Book — ${title} ${r.receipt_number}`,
      `${en ? "Date" : "Date"}: ${fmtDate(r.receipt_date)}`,
      `${en ? "Plan" : "Formule"}: ${r.plan_name || r.plan_id} · ${r.months} ${en ? "month(s)" : "mois"}`,
      `${en ? "Period" : "Période"}: ${fmtDate(r.period_from)} → ${fmtDate(r.period_to)}`,
      `${en ? "Amount" : "Montant"}: ${fmtMoney(r.amount, r.currency, en)}`,
      `PDF: ${link}`,
    ].join("\n");
    openWhatsApp(e, "", text);
  };

  return (
    <div className="card" style={{ marginTop: 20, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 600 }}>🧾 {en ? "Subscription receipts" : "Reçus d'abonnement"}</div>
        {q.data?.can_manage && (
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
            <input type="checkbox" checked={!!q.data?.managers_allowed} disabled={toggle.isPending}
              onChange={(ev) => toggle.mutate(ev.target.checked)} />
            {en ? "Managers can see receipts" : "Les gérants peuvent voir les reçus"}
          </label>
        )}
      </div>
      {q.isLoading && <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10 }}>{en ? "Loading…" : "Chargement…"}</div>}
      {q.isError && q.error?.response?.status !== 403 && (
        <div style={{ fontSize: 13, color: "var(--danger, #c0392b)", marginTop: 10 }}>{en ? "Could not load receipts." : "Impossible de charger les reçus."}</div>
      )}
      {q.isSuccess && rows.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10 }}>
          {en ? "No receipts yet — one is issued automatically for every confirmed subscription payment." : "Aucun reçu pour l'instant — un reçu est émis automatiquement pour chaque paiement d'abonnement confirmé."}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                <th style={{ padding: "6px 4px" }}>{en ? "Date" : "Date"}</th>
                <th style={{ padding: "6px 4px" }}>{en ? "No." : "N°"}</th>
                <th style={{ padding: "6px 4px" }}>{en ? "Plan" : "Formule"}</th>
                <th style={{ padding: "6px 4px" }}>{en ? "Months" : "Mois"}</th>
                <th style={{ padding: "6px 4px", textAlign: "right" }}>{en ? "Amount" : "Montant"}</th>
                <th style={{ padding: "6px 4px" }}>{en ? "Method" : "Moyen"}</th>
                <th style={{ padding: "6px 4px" }}>{en ? "Status" : "Statut"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>{fmtDate(r.receipt_date)}</td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap", fontFamily: "monospace" }}>{r.receipt_number}</td>
                  <td style={{ padding: "8px 4px" }}>{r.plan_name || r.plan_id}</td>
                  <td style={{ padding: "8px 4px" }}>{r.months}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{fmtMoney(r.amount, r.currency, en)}</td>
                  <td style={{ padding: "8px 4px" }}>{methodLabel(r.method, en)}</td>
                  <td style={{ padding: "8px 4px" }}>{r.kind === "credit_note" ? (en ? "Credit note" : "Avoir") : (en ? "Paid" : "Payé")}</td>
                  <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                    <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: 12 }} disabled={busy === r.id} onClick={() => download(r)}>
                      {busy === r.id ? "…" : "PDF"}
                    </button>{" "}
                    <button className="btn btn-secondary" style={{ padding: "4px 8px", fontSize: 12 }} onClick={(e) => share(e, r)} title="WhatsApp">
                      WhatsApp
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.isSuccess && q.data?.email?.available === false && (
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 10 }}>
          {en ? "Receipts are not emailed (no email service is set up) — download or share them here."
              : "Les reçus ne sont pas envoyés par e-mail (aucun service e-mail configuré) — téléchargez-les ou partagez-les ici."}
        </div>
      )}
    </div>
  );
}
