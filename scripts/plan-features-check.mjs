// LAUNCH-BATCH-2b: plan cards say "Stenamo Market" (never the old "Partenaire Dozie"), and a
// shop the Market is closed to (not XAF) is not offered it.
import { planFeatureList, planFeatureLabel } from "../src/utils/market.js";

let fails = 0;
const check = (name, ok, got) => { if (!ok) { fails++; console.log(`  FAIL  ${name}  ${JSON.stringify(got)}`); } else console.log(`  pass  ${name}`); };
const stored = JSON.stringify(["Everything in Lite", "Unlimited locations / products / users", "Partenaire Dozie marketplace", "Priority support"]);
const ng = planFeatureList(stored, { currency: "NGN" });
check("Nigerian shop: no Market line, nothing says Partenaire Dozie", ng.length === 3 && !ng.some((f) => /market|Partenaire Dozie/i.test(f)), ng);
const cm = planFeatureList(stored, { currency: "XAF" });
check("Cameroon shop: the line reads 'Stenamo Market'", cm.includes("Stenamo Market") && !cm.some((f) => /Partenaire Dozie/i.test(f)), cm);
check("already-array features work too", planFeatureList(["Sales", "Partenaire Dozie full access"], { currency: "XAF" })[1] === "Stenamo Market full access");
check("French shop reads the chips in French (30-day trial, Pro features)", planFeatureLabel("30-day free trial", "fr") === "Essai gratuit de 30 jours" && planFeatureLabel("Every Pro feature", "fr") === "Toutes les fonctions Pro" && planFeatureLabel("Sales", "en") === "Sales");
check("an unknown chip stays as stored, never blank", planFeatureLabel("Something new", "fr") === "Something new");
if (fails) { console.log(`\n  ${fails} FAILED`); process.exit(1); }
