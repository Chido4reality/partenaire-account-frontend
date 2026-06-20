// MP-DOZIE-SELLER-MIGRATION Phase 5 (final) — "Dozie Disputes".
//
// REPLY-ONLY: an MP-linked seller responds to a buyer's dispute (writes
// seller_reply). The ADMIN adjudicates the terminal states; the seller never
// changes status/amount/escrow. Money/refund stays Dozie-side. Buyers raise +
// view disputes in the Dozie app — same shared ptn_disputes rows.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useLangStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";

const DISPUTE_STATUS = {
  open:              { en: "Open", fr: "Ouvert", bg: "rgba(245,158,11,0.15)", fg: "#fbbf24" },
  resolved_refund:   { en: "Resolved — refunded buyer", fr: "Résolu — remboursé", bg: "rgba(239,68,68,0.15)", fg: "#f87171" },
  resolved_release:  { en: "Resolved — paid to you", fr: "Résolu — payé au vendeur", bg: "rgba(16,185,129,0.15)", fg: "#34d399" },
  resolved_partial:  { en: "Resolved — partial", fr: "Résolu — partiel", bg: "rgba(59,130,246,0.15)", fg: "#60a5fa" },
  closed:            { en: "Closed", fr: "Clôturé", bg: "rgba(148,163,184,0.18)", fg: "#94a3b8" },
};

export default function MyDozieDisputesPage() {
  const { lang } = useLangStore();
  const en = lang === "en";
  const fmt = useCurrency();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState({}); // disputeId -> reply text

  const { data: meData, isLoading: meLoading } = useQuery({
    queryKey: ["dozie-seller-me"],
    queryFn: () => api.get("/dozie/seller/me").then(r => r.data),
  });
  const linked = !!meData?.data?.linked;

  const { data: dispData, isLoading: dispLoading } = useQuery({
    queryKey: ["dozie-seller-disputes"],
    queryFn: () => api.get("/dozie/seller/disputes").then(r => r.data),
    enabled: linked,
    refetchInterval: 30000,
  });
  const disputes = dispData?.data || [];

  const replyMut = useMutation({
    mutationFn: ({ id, reply }) => api.post(`/dozie/seller/disputes/${id}/reply`, { reply }),
    onSuccess: (_d, v) => {
      toast.success(en ? "Reply sent — buyer notified" : "Réponse envoyée — acheteur notifié");
      setDrafts(d => ({ ...d, [v.id]: undefined }));
      qc.invalidateQueries(["dozie-seller-disputes"]);
    },
    onError: (e) => toast.error(e?.response?.data?.message || (en ? "Error" : "Erreur")),
  });

  const wrap = (children) => <div style={{ maxWidth: 720, margin: "0 auto", padding: 20 }}>{children}</div>;
  if (meLoading) return wrap(<div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>);
  if (!linked) {
    return wrap(
      <div className="card" style={{ textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>{en ? "Partenaire Dozie not activated" : "Partenaire Dozie non activé"}</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18 }}>
          {en ? "Activate your Dozie seller profile in Settings to handle buyer disputes here." : "Activez votre profil vendeur Dozie dans Paramètres pour gérer les litiges ici."}
        </div>
        <Link to="/settings" className="btn btn-primary">{en ? "Go to Settings" : "Aller aux Paramètres"}</Link>
      </div>
    );
  }

  return wrap(
    <div>
      <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{en ? "Dozie Disputes" : "Litiges Dozie"}</div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 14 }}>
        {en ? "Respond to buyer disputes. A support admin reviews and decides the outcome — you provide your side." : "Répondez aux litiges des acheteurs. Un admin support décide de l'issue — vous donnez votre version."}
      </div>

      {dispLoading && <div style={{ color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>}
      {!dispLoading && !disputes.length && <div style={{ color: "var(--text-muted)" }}>{en ? "No disputes — all clear. 🎉" : "Aucun litige. 🎉"}</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {disputes.map(d => {
          const sm = DISPUTE_STATUS[d.status] || { bg: "rgba(148,163,184,0.18)", fg: "#94a3b8", en: d.status, fr: d.status };
          const isOpen = d.status === "open";
          const draft = drafts[d.id] !== undefined ? drafts[d.id] : (d.seller_reply || "");
          return (
            <div key={d.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "var(--bg-card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{d.order_ref || (d.order_id || "").slice(0, 8)}</span>
                  <span className="badge" style={{ background: sm.bg, color: sm.fg, fontSize: 11, padding: "2px 8px", borderRadius: 10 }}>{en ? sm.en : sm.fr}</span>
                </div>
                {d.amount > 0 && <span style={{ fontWeight: 800, color: "var(--brand-light)" }}>{fmt(d.amount)}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                {d.buyer_name || (en ? "Buyer" : "Acheteur")} · {new Date(d.created_at).toLocaleDateString()}
              </div>
              <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "8px 12px", marginTop: 8, fontSize: 13 }}>
                <strong>{en ? "Buyer's claim:" : "Réclamation :"}</strong> {d.buyer_claim || "—"}
              </div>

              {/* Resolution note (admin) — read-only outcome */}
              {!isOpen && d.resolution_note && (
                <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "8px 12px", marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                  <strong>{en ? "Admin outcome:" : "Décision admin :"}</strong> {d.resolution_note}
                </div>
              )}

              {isOpen ? (
                <div style={{ marginTop: 10 }}>
                  <textarea className="input" rows={2} style={{ width: "100%", boxSizing: "border-box" }}
                    placeholder={en ? "Your response to this dispute…" : "Votre réponse au litige…"}
                    value={draft} onChange={e => setDrafts(s => ({ ...s, [d.id]: e.target.value }))} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button className="btn btn-sm btn-primary" disabled={!draft.trim() || replyMut.isPending}
                      onClick={() => replyMut.mutate({ id: d.id, reply: draft.trim() })}>
                      {replyMut.isPending ? "…" : (d.seller_reply ? (en ? "Update reply" : "Mettre à jour") : (en ? "Send reply" : "Envoyer"))}
                    </button>
                  </div>
                </div>
              ) : d.seller_reply ? (
                <div style={{ background: "rgba(16,185,129,0.08)", borderRadius: 10, padding: "8px 12px", marginTop: 8, fontSize: 13 }}>
                  <strong>{en ? "Your reply:" : "Votre réponse :"}</strong> {d.seller_reply}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
