// SUPPORT MESSAGING + LOGIN DIAGNOSTICS — do the screens RENDER, and say only true things?
//
// A. Admin portal: evaluates the REAL inline script out of public/admin.html (no build step,
//    so parsing proves nothing) and drives the Messages helpers + loadMessages with stubbed
//    API payloads. Guards: reachability is shown as facts (iPhone = never pushable, deleted =
//    cannot sign in), "accepted by Google" is never presented as seen/delivered, a deleted org
//    cannot be written to, hostile names stay inert, the link is master-admin only.
// B. Shop app: the real MessageThread and the login failure UI (props-only, renderToString).
// C. Registration: /messages is wired in every place a nav route lives (Layout NAV, the
//    mobile drawer SECTIONS, App ROUTE_ACCESS) and is not hidden in Lite.
import { readFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
let fails = 0;
const check = (label, ok, detail = "") => { if (!ok) fails++; console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail !== "" ? `  [${detail}]` : ""}`); };

// ── A. admin portal ──────────────────────────────────────────────────────────────────────
const html = readFileSync(resolve(ROOT, "public/admin.html"), "utf8");
function makeEl(id = "") {
  return { id, _html: "", textContent: "", value: "", disabled: false, dataset: {}, style: {}, scrollTop: 0, scrollHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, children: [],
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    addEventListener() {}, removeEventListener() {}, getAttribute() { return null; }, setAttribute() {},
    closest() { return null; }, focus() {}, querySelectorAll() { return []; }, appendChild(c) { this.children.push(c); return c; }, remove() {}, getContext() { return {}; } };
}
const els = new Map();
const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
const document = { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => makeEl(),
  body: makeEl("body"), documentElement: makeEl("html") };
const sandbox = {
  document, localStorage: { getItem: () => "tok", setItem() {}, removeItem() {} }, console,
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, location: { hash: "" }, prompt: () => null },
  location: { hash: "", href: "http://x/admin.html", origin: "http://x", hostname: "admin.test", protocol: "http:", pathname: "/admin.html", search: "" },
  navigator: { userAgent: "node", language: "en" },
  setTimeout, clearTimeout, setInterval, clearInterval, Intl, Date, Math, JSON,
  fetch: async () => ({ ok: true, status: 200, text: async () => "{}", json: async () => ({}) }),
  prompt: () => null, alert: () => {}, confirm: () => true,
  MutationObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
  ResizeObserver: class { observe() {} disconnect() {} unobserve() {} }, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  URL, URLSearchParams, Blob: class {}, FormData: class {}, AbortController: globalThis.AbortController, Promise, Error, RegExp,
  encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat, Number, String, Boolean, Array, Object,
  Chart: class { destroy() {} },
};
sandbox.globalThis = sandbox;
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let script = blocks.reduce((a, b) => (b.length > a.length ? b : a), "");
{ const t = script.trim(); const open = t.indexOf("(function () {"); const close = t.lastIndexOf("})();"); if (open === 0 && close > 0) script = t.slice("(function () {".length, close); }

console.log("\nA. admin portal — Messages");
const ctx = vm.createContext(sandbox);
try { new vm.Script(script, { filename: "admin.html:inline" }).runInContext(ctx); check("the real inline script EVALUATES", true); }
catch (err) { check("the real inline script EVALUATES", false, err.message); console.log(`\n  ${fails} FAILED\n`); process.exit(1); }
for (const fn of ["loadMessages", "renderMsgCustomers", "renderMsgThread", "msgStatusLine", "msgReachLabel", "openMsgThread", "sendMsg"])
  check(`${fn} is defined`, typeof ctx[fn] === "function", typeof ctx[fn]);

const CUSTOMERS = [
  { org_id: "o1", name: "EST LE SOLDEUR", mp_id: "MP-1", reach: "push", owner: { name: "Paul" }, thread: { unread_from_owner: 2, last_message_at: "2026-10-05T10:00:00Z", last: { from: "owner", preview: "Merci !" } } },
  { org_id: "o2", name: "Miondo Bar", mp_id: "MP-40", reach: "iphone", owner: { name: "Fabrice" }, thread: null },
  { org_id: "o3", name: "Dozass", reach: "cannot_sign_in", owner: { name: "X" }, thread: null },
  { org_id: "o4", name: "<img src=x onerror=alert(1)>", reach: "next_visit", owner: { name: "Y" }, thread: null },
];
const list = ctx.renderMsgCustomers(CUSTOMERS, "", null);
check("Paul's row: push possible + 2 unread replies", list.includes("📱 Push possible") && /msg-unread">2</.test(list));
check("iPhone owner says 'never pushable' — a fact, not a hope", list.includes("🍎 iPhone (browser) — never pushable"));
check("deleted org says 'Cannot sign in'", list.includes("⛔ Cannot sign in"));
check("a hostile business name stays inert text", !list.includes("<img src=x") && list.includes("&lt;img"));
check("unread replies sort first", list.indexOf("EST LE SOLDEUR") < list.indexOf("Miondo Bar"));
check("search filters by owner name", ctx.renderMsgCustomers(CUSTOMERS, "fabri", null).includes("Miondo Bar") && !ctx.renderMsgCustomers(CUSTOMERS, "fabri", null).includes("SOLDEUR"));

const thread = (reach, msgs) => ctx.renderMsgThread({ org: { name: "T", lite_mode: true }, owner: { name: "Paul", phone: "69" }, reach, messages: msgs });
const accepted = thread("push", [{ id: "m1", from: "admin", body: "Bonjour", created_at: "2026-10-05T10:00:00Z", push: "accepted", read: false, replied: false }]);
check("a push Google accepted says so — and says it is NOT proof they saw it", accepted.body.includes("Push accepted by Google (not proof they saw it)") && accepted.body.includes("Not read yet"));
check("…and never claims 'delivered' or 'seen'", !/delivered|seen/i.test(accepted.body.replace("not proof they saw it", "")));
const failed = thread("push", [{ id: "m2", from: "admin", body: "x", created_at: "2026-10-05T10:00:00Z", push: "failed", push_errors: ["messaging/registration-token-not-registered"], read: false, replied: false }]);
check("a failed push names FCM's reason", failed.body.includes("Push FAILED (messaging/registration-token-not-registered)"));
const noDev = thread("next_visit", [{ id: "m3", from: "admin", body: "x", created_at: "2026-10-05T10:00:00Z", push: "no_device", read: true, replied: true }]);
check("no device → 'in the app only'; read + replied shown", noDev.body.includes("No push device — in the app only") && noDev.body.includes("✓ Read") && noDev.body.includes("↩ Replied"));
check("Lite owner: the header says there is no bell, the badge is how they see it", accepted.head.includes("Lite mode (no bell"));
check("deleted org: composer disabled", thread("cannot_sign_in", []).canSend === false);
check("no owner: composer disabled", thread("no_owner", []).canSend === false);
check("push-able owner: composer enabled", accepted.canSend === true);

ctx.apiAdmin = async (method, path) => (path === "/admin/messages/customers" ? { data: CUSTOMERS } : { data: {} });
await ctx.loadMessages();
check("loadMessages renders the list from the API", getEl("msg-customers").innerHTML.includes("EST LE SOLDEUR"));
check("the sidebar link is shown to master admins ONLY", /const msgLink = \$\('sb-link-messages'\);\s*if \(msgLink\) msgLink\.style\.display = isMaster \? '' : 'none';/.test(html));
check("'messages' is a valid route and dispatches loadMessages", /'messages', 'broadcasts'/.test(html) && /if \(route === 'messages'\)\s+loadMessages\(\);/.test(html));

// ── B. shop screens ─────────────────────────────────────────────────────────────────────
console.log("\nB. shop app — Messages + login diagnostics");
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");
const OUT = resolve(HERE, "__msg_render.mjs");
const STUBS = {
  "../utils/api": "export default {}; export const appClient = () => 'web/desktop';",
  "../store": "export const useLangStore = () => ({ lang: 'fr', t: (k) => k }); export const useAuthStore = () => ({ login() {} });",
  "../utils/setLanguage": "export const setLanguageLocalPending = () => {};",
};
await build({
  stdin: { contents: `export { MessageThread } from "./pages/MessagesPage.jsx"; export { loginFailure, LoginFailure } from "./pages/LoginPage.jsx";`, resolveDir: resolve(ROOT, "src"), loader: "jsx" },
  bundle: true, format: "esm", outfile: OUT, jsx: "automatic", platform: "node", logLevel: "silent",
  external: ["react", "react/jsx-runtime", "react-router-dom", "react-hot-toast", "@tanstack/react-query"],
  banner: { js: `import { createRequire as __cr } from "module"; const require = __cr(import.meta.url);` },
  plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (STUBS[a.path] !== undefined ? { path: a.path, namespace: "stub" } : null));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
  } }],
});
const unescape = (s) => s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
try {
  const M = await import(pathToFileURL(OUT).href + `?t=${Date.now()}`);
  const r = (C, p) => unescape(renderToString(React.createElement(C, p)));
  const t = r(M.MessageThread, { lang: "fr", messages: [
    { id: "1", from: "admin", sender_name: "Équipe Stenamo", body: "Bonjour Paul <b>!</b>", created_at: "2026-10-05T10:00:00Z" },
    { id: "2", from: "owner", sender_name: null, body: "Merci", created_at: "2026-10-05T10:05:00Z" } ] });
  check("owner sees 'Équipe Stenamo' and 'Vous'", t.includes("Équipe Stenamo") && t.includes("Vous"));
  check("a message body is text, not markup", !renderToString(React.createElement(M.MessageThread, { lang: "fr", messages: [{ id: "x", from: "admin", body: "<b>x</b>", created_at: "2026-10-05T10:00:00Z" }] })).includes("<b>x</b>"));
  check("empty thread says so", r(M.MessageThread, { lang: "fr", messages: [] }).includes("Aucun message"));

  const F = M.loginFailure;
  const net = F({ code: "ERR_NETWORK" }, "fr");
  check("network failure: says why, in French, with the code", /Impossible de joindre le serveur/.test(net.message) && net.code === "ERR_NETWORK", JSON.stringify(net));
  check("timeout: code 'timeout'", F({ code: "ECONNABORTED" }, "fr").code === "timeout");
  const rl = F({ response: { status: 429, data: { code: "rate_limited", message: "rate limited", message_fr: "Trop de requêtes" } } }, "fr");
  check("429: French explanation, never the raw 'rate limited'", /Trop d'essais/.test(rl.message) && !/rate limited/.test(rl.message) && rl.code.includes("429"), JSON.stringify(rl));
  check("401: the server's message", F({ response: { status: 401, data: { message: "Identifiants incorrects" } } }, "fr").message === "Identifiants incorrects");
  check("disabled account: its own bilingual line", F({ response: { status: 401, data: { error: "account_disabled", message_fr: "Compte désactivé", message_en: "Account disabled" } } }, "en").message === "Account disabled");
  const box = r(M.LoginFailure, { failure: net });
  check("the failure renders ON the screen with its code", box.includes("data-login-error") && box.includes("ERR_NETWORK"));
  check("no failure → nothing rendered", renderToString(React.createElement(M.LoginFailure, { failure: null })) === "");
} catch (e) { check("shop bundle", false, e.stack || e.message); }
finally { try { rmSync(OUT, { force: true }); } catch { /* */ } }

// ── C. registration (a nav route lives in more than one place) ─────────────────────────
console.log("\nC. /messages is wired everywhere a route lives");
const layout = readFileSync(resolve(ROOT, "src/components/common/Layout.jsx"), "utf8");
const drawer = readFileSync(resolve(ROOT, "src/components/layout/NavDrawer.jsx"), "utf8");
const app = readFileSync(resolve(ROOT, "src/App.jsx"), "utf8");
check("Layout NAV has /messages for owners, with a badge", /\{ to: "\/messages",[^}]*roles: \["owner"\][^}]*badge: "messages" \}/.test(layout));
check("…and it is NOT hidden in Lite", !/LITE_HIDDEN_ROUTES = new Set\(\[[^\]]*"\/messages"/.test(layout));
check("the mobile drawer SECTIONS list it", /routes: \["\/messages", "\/help"\]/.test(drawer));
check("the drawer renders its badge", /item\.badge === "messages" && messagesUnread > 0/.test(drawer));
check("App ROUTE_ACCESS: owner only", /"\/messages": \["owner"\]/.test(app));
check("the route exists", /<Route path="messages"/.test(app));
check("a push tap / bell row opens /messages", /ref_type === "admin_message"\) navigate\("\/messages"\)/.test(layout) && /n\.ref_type === "admin_message"\) return `\/messages`/.test(layout));
check("the dashboard strip is declared AFTER the count it reads (no TDZ)", layout.indexOf("const messagesUnread =") > 0 && layout.indexOf("const messagesUnread =") < layout.indexOf("const messagesStrip ="));

console.log(fails ? `\n  ${fails} FAILED\n` : "\n  all passed\n");
process.exit(fails ? 1 : 0);
