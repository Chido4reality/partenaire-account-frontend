// STAFF DEACTIVATE — Settings → Staff asks first, and a flip refreshes both staff lists
// (Peter, 2026-10-30). Accountant Log always asked; Settings cut the person off on one click.
// Each list stays fresh for 30s, so a flip on one screen could leave the other showing the
// old status.
//
// Drives the REAL utils/staffLists.js against a real QueryClient, and reads both pages' source
// for the wiring: the row button only opens the dialog, and only the dialog sends the PATCH.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const settings = read("src/pages/SettingsPage.jsx");
const log = read("src/pages/AccountantLogPage.jsx");

let fails = 0;
const check = (label, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${!ok && detail ? `  [${detail}]` : ""}`);
};

// The body of a named useMutation, so a call elsewhere in the page cannot satisfy the check.
const mutationBody = (src, name) => {
  const start = src.indexOf(`const ${name} = useMutation(`);
  if (start < 0) return "";
  const end = src.indexOf("\n  });", start);
  return src.slice(start, end);
};

// ── Settings → Staff: the row button asks, the dialog acts ──
const rowButton = settings.match(/<button onClick=\{\(\) => ([^}]*)\}[^>]*>\s*\{lang === "en" \? "Deactivate" : "Désactiver"\}/s);
const rowOpensDialog = /<button onClick=\{\(\) => setConfirmDeactivate\(s\)\}/.test(settings);
check("the row's Deactivate button only opens the dialog", rowOpensDialog, rowButton?.[1]);
const dialogStart = settings.indexOf("{confirmDeactivate && (");
const dialog = dialogStart < 0 ? "" : settings.slice(dialogStart, settings.indexOf("\n      )}", dialogStart));
check("the dialog exists", !!dialog);
check("only the dialog sends the deactivate",
  (settings.match(/deactivateStaffMutation\.mutate\(/g) || []).length === 1
    && dialog.includes("deactivateStaffMutation.mutate(confirmDeactivate.id)"));
check("the dialog names the person, in both languages",
  (dialog.match(/\$\{confirmDeactivate\.full_name\}/g) || []).length === 2);
for (const [label, text] of [
  ["EN title", "Deactivate this person?"], ["FR title", "Désactiver cette personne ?"],
  ["EN body", "will be logged out and blocked from the app until you reactivate them."],
  ["FR body", "sera déconnecté et bloqué jusqu'à réactivation."],
]) {
  check(`same wording as Accountant Log: ${label}`, dialog.includes(text) && log.includes(text));
}
check("the dialog has a Cancel that sends nothing",
  /onClick=\{\(\) => setConfirmDeactivate\(null\)\}>\{lang === "en" \? "Cancel" : "Annuler"\}/.test(dialog));
check("the confirm button is disabled while sending (no double PATCH)",
  dialog.includes("disabled={deactivateStaffMutation.isPending}"));
const deact = mutationBody(settings, "deactivateStaffMutation");
check("the dialog closes on success", deact.includes("setConfirmDeactivate(null)"));
check("the dialog stays open on a refusal (the error is read beside it)",
  !deact.slice(deact.indexOf("onError")).includes("setConfirmDeactivate"));

// ── Every flip, on either screen, refreshes the lists ──
for (const [label, body] of [
  ["Settings deactivate", deact],
  ["Settings reactivate", mutationBody(settings, "reactivateStaffMutation")],
  ["Accountant Log deactivate/reactivate", mutationBody(log, "toggleActive")],
]) {
  check(`${label} calls refreshStaffLists`, body.includes("refreshStaffLists(qc)"));
}

// ── The helper, on a real QueryClient: every list actually goes stale ──
const dir = mkdtempSync(join(tmpdir(), "staff-lists-"));
try {
  const out = join(dir, "bundle.mjs");
  await build({
    stdin: {
      contents: `export { refreshStaffLists } from ${JSON.stringify(join(ROOT, "src/utils/staffLists.js"))};
                 export { QueryClient } from "@tanstack/react-query";`,
      resolveDir: ROOT,
    },
    bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent",
  });
  const { refreshStaffLists, QueryClient } = await import(pathToFileURL(out).href);
  const qc = new QueryClient();
  const keys = [["staff"], ["accountant-log-watched"], ["staff-attendance-team", "month"]];
  const other = ["stock"];
  for (const k of [...keys, other]) qc.setQueryData(k, { seeded: true });
  refreshStaffLists(qc);
  for (const k of keys) check(`${JSON.stringify(k)} goes stale`, qc.getQueryState(k)?.isInvalidated === true);
  check("an unrelated list is left alone", qc.getQueryState(other)?.isInvalidated === false);
  qc.clear();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails ? `\n  ${fails} FAILED` : "\n  all passed");
process.exit(fails ? 1 : 0);
