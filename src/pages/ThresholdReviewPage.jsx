// MP-THRESHOLD-REVIEW — the one-time "review your approval thresholds" screen.
//
// WHY THIS SCREEN EXISTS
// "Approve any action above X" has been settable since launch and has never
// gated anything for anybody. The database clause was always there, guarded on
// the per-action policy being 'allow'; for every row that carries a value those
// actions are set to approve/block, so the clause is unreachable. Ten owners
// configured a safeguard that has never once fired.
//
// Making it work is a BEHAVIOUR CHANGE, and a violent one for some: on prod it
// would gate 29.8% of one active person's sales, and 84.9% of a shop login's.
// A safeguard that switches on silently and halts most of a shop's sales is an
// outage, not protection — so the gate requires a confirmation stamp, and THIS
// SCREEN IS WHAT SETS IT. The review is the switch.
//
// The owner sees, per person, what his own number would have done to his own
// last 90 days. Nobody should have to discover that from a cashier phoning to
// say the till is asking for permission on a 5,000 sale.
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../utils/api";
import { useLangStore } from "../store";
import toast from "react-hot-toast";

// Severity from the share of sales that would be interrupted. The bands are a
// judgement, not a calculation: below 5% a threshold reads as an exception
// catcher, above 20% it reads as the staffer needing permission to do their job.
const band = (pct) => (pct >= 20 ? "high" : pct >= 5 ? "mid" : "low");
const BAND_COLOR = { high: "var(--danger)", mid: "var(--warning)", low: "var(--success)" };

export default function ThresholdReviewPage() {
  const lang = useLangStore((s) => s.lang) || "fr";
  const en = lang === "en";
  const nav = useNavigate();
  const qc = useQueryClient();
  const [edits, setEdits] = useState({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["threshold-review"],
    queryFn: () => api.get("/staff/threshold-review").then((r) => r.data),
  });

  const money = (n) =>
    n == null ? "—" : Number(n).toLocaleString(en ? "en-US" : "fr-FR");

  const rows = data?.data || [];
  const active = useMemo(() => rows.filter((r) => r.is_active), [rows]);
  const inactive = useMemo(() => rows.filter((r) => !r.is_active), [rows]);

  const valueFor = (r) =>
    Object.prototype.hasOwnProperty.call(edits, r.user_id)
      ? edits[r.user_id]
      : (r.threshold ?? "");

  const confirmMut = useMutation({
    mutationFn: () =>
      api.post("/staff/threshold-review/confirm", {
        edits: Object.entries(edits).map(([user_id, approve_above_amount]) => ({
          user_id, approve_above_amount,
        })),
      }),
    onSuccess: () => {
      toast.success(en ? "Approval thresholds are now active" : "Les seuils d'approbation sont actifs");
      qc.invalidateQueries({ queryKey: ["threshold-review"] });
      qc.invalidateQueries({ queryKey: ["my-permissions"] });
      nav(-1);
    },
    onError: (e) =>
      toast.error(e?.response?.data?.message || (en ? "Could not save" : "Échec de l'enregistrement")),
  });

  // ⚠️ isError is NOT the empty state — a failed fetch renders as "nothing to
  // review", which here would read as "you have no thresholds set" to an owner
  // who has nine. Separate branch, with a retry.
  if (isError) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {en ? "Could not load your thresholds" : "Impossible de charger vos seuils"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
          {en ? "This is a connection problem, not an empty list."
              : "C'est un problème de connexion, pas une liste vide."}
        </div>
        <button className="btn btn-primary" onClick={() => refetch()}>
          {en ? "Try again" : "Réessayer"}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <div style={{ padding: 16, color: "var(--text-muted)" }}>{en ? "Loading…" : "Chargement…"}</div>;
  }

  if (!rows.length) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          {en ? "No approval thresholds set" : "Aucun seuil d'approbation défini"}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {en ? "Nobody on your team has a threshold. Nothing to review."
              : "Personne dans votre équipe n'a de seuil. Rien à revoir."}
        </div>
      </div>
    );
  }

  const Row = ({ r }) => {
    const pct = Number(r.pct_gated) || 0;
    const b = band(pct);
    const noSales = !r.sales_90d;
    return (
      <div style={{ padding: "12px 13px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>{String(r.full_name || "").trim()}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.role}</span>
        </div>

        {/* THE SHARED-LOGIN SENTENCE. There is no structural marker separating a
            person from a shop login — "Bepanda Shop" is role='cashier' like
            everyone else and matches no location record. So this does not try to
            classify. It states what the threshold binds to, which reads normally
            for a person and makes a shared till obvious to the owner. */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
          {en ? <>Applies to every sale rung up under the login <b>{String(r.full_name || "").trim()}</b>, whoever is using it.</>
              : <>S'applique à chaque vente enregistrée sous le compte <b>{String(r.full_name || "").trim()}</b>, quelle que soit la personne qui l'utilise.</>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)", flex: 1 }}>
            {en ? "Ask me above" : "Me demander au-dessus de"}
          </span>
          <input
            type="number" min="0" className="input" style={{ width: 140 }}
            value={valueFor(r)}
            placeholder={en ? "no limit" : "sans limite"}
            onChange={(e) => setEdits((p) => ({ ...p, [r.user_id]: e.target.value }))}
          />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3 }}>
          {en ? "Leave BLANK to never ask." : "Laissez VIDE pour ne jamais demander."}
        </div>

        {/* What their own history says. Plain language, never the word median —
            "half of X's sales are under Y" is the same fact a shopkeeper can act on. */}
        <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.5 }}>
          {noSales ? (
            <span style={{ color: "var(--text-muted)" }}>
              {en ? "No sales in the last 90 days, so there is nothing to compare this against."
                  : "Aucune vente ces 90 derniers jours : rien à quoi comparer ce chiffre."}
            </span>
          ) : (
            <>
              <div style={{ color: "var(--text-muted)" }}>
                {en ? <>Half of {String(r.full_name || "").trim()}'s sales are under <b>{money(r.half_under)}</b>. Biggest: <b>{money(r.biggest)}</b>.</>
                    : <>La moitié des ventes de {String(r.full_name || "").trim()} sont sous <b>{money(r.half_under)}</b>. La plus grande : <b>{money(r.biggest)}</b>.</>}
              </div>
              <div style={{ marginTop: 4, fontWeight: 600, color: BAND_COLOR[b] }}>
                {en ? <>{r.would_gate} of their last {r.sales_90d} sales would have needed your approval ({pct}%).</>
                    : <>{r.would_gate} de leurs {r.sales_90d} dernières ventes auraient demandé votre approbation ({pct} %).</>}
              </div>
              {b === "high" && (
                <div style={{ marginTop: 4, fontSize: 11.5, fontWeight: 600, color: "var(--danger)" }}>
                  ⚠ {en ? "At this number they would need permission for most of their work."
                        : "À ce niveau, ils auraient besoin d'une permission pour la plupart de leur travail."}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 14, maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>
        {en ? "Review your approval thresholds" : "Vérifiez vos seuils d'approbation"}
      </h2>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 12 }}>
        {en ? "You set these numbers so big actions would come to you first. They have not been working. Check each one below and turn them on — you will start being asked straight away, so it is worth seeing what that means for each person."
            : "Vous avez défini ces montants pour que les grosses actions vous soient soumises. Ils n'ont pas fonctionné. Vérifiez chacun ci-dessous puis activez-les — les demandes commenceront aussitôt, d'où l'intérêt de voir ce que cela change pour chaque personne."}
      </div>

      {/* The old label promised more than the gate delivers, which is half of how
          we got here. Say exactly what it covers and what it does not. */}
      <div style={{ padding: "10px 12px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 14, fontSize: 12.5, lineHeight: 1.55 }}>
        <div><b>{en ? "Will ask for approval on:" : "Demandera votre approbation pour :"}</b>{" "}
          {en ? "sales, discounts, credit, expenses, cancellations, refunds, debt adjustments."
              : "ventes, remises, crédit, dépenses, annulations, remboursements, ajustements de dette."}</div>
        <div style={{ marginTop: 4, color: "var(--text-muted)" }}><b>{en ? "Will not apply to:" : "Ne s'applique pas à :"}</b>{" "}
          {en ? "stock adjustments, transfers, or a customer paying off a debt they already owe."
              : "ajustements de stock, transferts, ni au règlement d'une dette déjà due par un client."}</div>
        <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
          {en ? "A sale is measured BEFORE any discount, so a discount cannot be used to slip under the number."
              : "Une vente est mesurée AVANT toute remise : une remise ne peut donc pas servir à passer sous le seuil."}
        </div>
      </div>

      {active.map((r) => <Row key={r.user_id} r={r} />)}

      {inactive.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
            {en ? "Turned-off accounts" : "Comptes désactivés"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
            {en ? "These cannot sign in, so their number does nothing until you turn the account back on. It is kept so it does not surprise you later."
                : "Ces comptes ne peuvent pas se connecter : leur montant ne fait rien tant que vous ne les réactivez pas. Il est conservé pour ne pas vous surprendre plus tard."}
          </div>
          {inactive.map((r) => <Row key={r.user_id} r={r} />)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={confirmMut.isPending}
          onClick={() => confirmMut.mutate()}>
          {confirmMut.isPending ? "…" : (en ? "Turn these on" : "Activer ces seuils")}
        </button>
        <button className="btn" disabled={confirmMut.isPending} onClick={() => nav(-1)}>
          {en ? "Decide later" : "Décider plus tard"}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
        {en ? "Until you turn them on, none of these numbers do anything — exactly as it has been."
            : "Tant que vous ne les activez pas, aucun de ces montants n'a d'effet — exactement comme jusqu'ici."}
      </div>
    </div>
  );
}
