import axios from "axios";
import { useAuthStore, useLangStore } from "../store";
import { enqueue, configureSync, startWorker, genLocalId } from "./pendingSync";
import { getNetworkStatus, recordWriteFailure, recordWriteSuccess } from "./network";

// Default 6s timeout for reads + auth so a dropped/partial network surfaces
// fast instead of hanging. (The old 15s was "generous" to let a now-DELETED
// service worker's 4s abort fire first — that SW was retired in vite.config's
// Slice-3 cleanup, so 15s just became a silent ~15s freeze on every read/login
// when the network drops.) Offline-eligible writes get 15s back via the
// request interceptor below — they enqueue on failure through
// offlineAwareAdapter, so a longer ceiling there only lets a slow-but-up
// backend ack before we fall back to the optimistic queue.
const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const api = axios.create({ baseURL: BASE_URL, timeout: 6000 });

// MP-CAPACITOR-AND-OFFLINE-FIRST-ARCHITECTURE Slice 3: hand the
// queue worker the same baseURL + auth token getter we use here so
// it can replay queued POSTs against the same backend. configureSync
// is idempotent — calling it on every module load is fine.
configureSync({
  baseUrl:      BASE_URL,
  getAuthToken: () => useAuthStore.getState().token,
});
startWorker();

// MP-CAPACITOR Slice 3: write paths that participate in the offline
// queue. When the device is offline, POSTs to these endpoints are
// enqueued + returned to the caller with an optimistic response so
// the cashier UI can move forward; when online, they fire normally
// but a 5xx still gets caught + enqueued so a transient outage
// doesn't lose the write either.
//
// MP-REFUNDS-ONLINE-ONLY: refunds / exchanges / voids are NO LONGER offline-
// eligible. They rely on the server-side atomic RPC (process_return_exchange /
// void_sale) and cannot be replayed safely from the queue — an offline one
// can't resolve the original sale line (product + net_amount), so it produced
// malformed "Refund 0" rows. The return flow now hard-gates on connectivity in
// VoidReturnModal; keeping these OUT of OFFLINE_ELIGIBLE means a POST while
// offline simply fails (and is never queued) instead of being optimistically
// enqueued. Normal sales (/sales, /sales/:id/payment) stay offline-first.
const OFFLINE_ELIGIBLE = [
  { rx: /^\/sales\/?$/,                            method: "POST" },
  { rx: /^\/sales\/[^/]+\/payment\/?$/,            method: "POST" },
  { rx: /^\/expenditures\/?$/,                     method: "POST" },
  // MP-PHASE-4.2: actual backend route is /api/transfers (not /stock-transfers).
  // The misnamed regex meant offline transfers fell through to the network and
  // 6s-hung. Backend already dedupes by local_id (transfers.js + syncDedupe),
  // so the queue is replay-safe end-to-end.
  { rx: /^\/transfers\/?$/,                         method: "POST" },
  // MP-TRANSFER-RECEIVE-CONFIRM (Phase 1): dispatch + one-tap confirm ride the same
  // queue. Backend dedupes via dedupeByEndpointLocalId (pa_offline_dedup) + the
  // .eq('status', …) transition guard, so replay is idempotent end-to-end.
  { rx: /^\/transfers\/[^/]+\/dispatch\/?$/,        method: "POST" },
  { rx: /^\/transfers\/[^/]+\/confirm-receipt\/?$/, method: "POST" },
  { rx: /^\/stock\/arrivals\/?$/,                  method: "POST" },
  // MP-PHASE-3-OFFLINE-SHIFT: shift open/close ride the same queue.
  { rx: /^\/shifts\/open\/?$/,                      method: "POST" },
  { rx: /^\/shifts\/[^/]+\/close\/?$/,              method: "POST" },
  // MP-PHASE-4.4: offline collect-debt + stock-count via the generic
  // pa_offline_dedup seam (backend syncDedupe.dedupeByEndpointLocalId).
  { rx: /^\/customers\/[^/]+\/collect-debt\/?$/,    method: "POST" },
  { rx: /^\/stock\/count\/?$/,                      method: "POST" },
  // MP-PHASE-4.5: offline inventory writes via the same dedup seam +
  // peek pattern (PATCH handlers' approval-token gate is short-
  // circuited by peekDedup on replay so a single original token
  // consumption isn't relitigated).
  { rx: /^\/products\/?$/,                          method: "POST"  },
  { rx: /^\/products\/[^/]+\/?$/,                   method: "PATCH" },
  { rx: /^\/stock\/adjust\/?$/,                     method: "PATCH" },
];

function isOfflineEligible(method, url) {
  if (!url) return false;
  const m = (method || "GET").toUpperCase();
  // Strip query string + leading baseURL if axios resolved it.
  const path = url.replace(BASE_URL, "").split("?")[0];
  return OFFLINE_ELIGIBLE.some(e => e.method === m && e.rx.test(path));
}

// Optimistic response for offline enqueue. The cashier UI expects a
// {data: {...}} shape mirroring the backend's success payload.
// Server fields the device can't know yet (sale_number, server_id,
// created_at) get OFFLINE-prefixed placeholders the UI can display
// + the canonical values land on the local mirror when the queue
// drains and the dedupe replay returns the server's row.
function buildOptimisticResponse(endpoint, payload, localId) {
  const ts = Date.now();
  const offlineRef = `OFFLINE-${ts}`;
  return {
    data: {
      success: true,
      offline_queued: true,
      data: {
        server_id:    null,
        local_id:     localId,
        sale_number:  offlineRef,
        return_ref:   offlineRef,
        // MP-PHASE-3-OFFLINE-SHIFT: /shifts/open carries the client shift PK
        // as payload.id; the UI reads `shift_id`, so surface it here.
        shift_id:     payload.id || localId,
        ...payload,
        // Common echo fields the UI reads.
        id:           localId,
        created_at:   new Date(ts).toISOString(),
      },
    },
    status:     202,
    statusText: "Queued for sync",
    headers:    {},
    config:     {},
  };
}

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // MP-CAPACITOR Slice 3: stamp local_id on every offline-eligible
  // POST regardless of online state. Online → backend dedupes via
  // (org_id, local_id) unique index (Slice 1). Offline → the queue
  // worker reuses this exact local_id on replay so the same write
  // can't land twice.
  if (isOfflineEligible(config.method, config.url) && config.data && typeof config.data === "object" && !config.data.local_id) {
    config.data = { ...config.data, local_id: genLocalId() };
  }
  // MP-PHASE-3-OFFLINE-SHIFT: stamp a client UUID as the shift PK (`id`) on
  // an offline /shifts/open. The backend INSERTs it idempotently, so the
  // open's replay is dedup-safe and the sales rung against this shift resolve
  // server-side once it lands. genLocalId() is UUID-v4-shaped (crypto.randomUUID
  // or a v4-shaped fallback), matching the backend's id regex.
  const _path = (config.url || "").replace(BASE_URL, "").split("?")[0];
  if (/^\/shifts\/open\/?$/.test(_path) && config.data && typeof config.data === "object" && !config.data.id) {
    config.data = { ...config.data, id: genLocalId() };
  }
  // MP-PRODUCTS-OFFLINE-ID-STAMP (Bug X, 1 Jun): same precedent as
  // /shifts/open. The offline-eligible POST /products needs the client
  // to stamp the product's primary-key UUID BEFORE the request leaves
  // the device. Without it, the optimistic 202 surfaces id=<localId>
  // and the cashier's UI references that — but on later queue replay
  // the backend generates a NEW server-side UUID, so any /stock/arrivals
  // POSTed in the same offline window (carrying items[].product_id =
  // <localId>) FK-violates against pa_arrival_items on replay. Result:
  // product exists, but arrival never lands, qty stays at 0 forever
  // — Peter's "Painting brush" repro.
  //
  // Reusing payload.local_id as id makes the offline-stamped UUID
  // identical to the dedup key. The backend (post-Bug-X commit)
  // validates UUID v4 and honors the value on insert, so the
  // arrival's product_id resolves cleanly. Stamped AFTER the local_id
  // block above so payload.local_id is already populated.
  if (/^\/products\/?$/.test(_path) && config.data && typeof config.data === "object" && !config.data.id && config.data.local_id) {
    config.data = { ...config.data, id: config.data.local_id };
  }
  // Offline-eligible writes get a 45s ceiling: they enqueue on failure,
  // and Render's free-tier cold-start can take 30-60s when the container
  // has been idle. Paul (Cameroon, 1 Jun) hit "Exhausted 5 attempts:
  // signal aborted without reason" because every aborted-at-15s request
  // killed the in-flight TCP socket before Render finished booting →
  // queue retries kept hitting cold containers. 45s gives the typical
  // 30-50s cold-start window room to land while keeping the abort
  // short enough that a truly dead network still surfaces within a
  // minute. Reads/auth stay on the 6s default (fail fast — the offline
  // UI flips quickly when network drops mid-read). App.jsx fires a
  // warm-up /health ping at launch to prime the container, which
  // covers the dominant "open app, start working" flow.
  if (isOfflineEligible(config.method, config.url)) config.timeout = 45000;
  return config;
});

// MP-CAPACITOR Slice 3: pre-flight check for offline-eligible writes.
// If the device is offline we never even hit the network — straight
// to the queue, optimistic response returned synchronously. Wrap in
// an adapter-style shim that runs BEFORE axios's transport so axios
// doesn't surface a network error to the caller.
// axios v1's defaults.adapter is a selector array (e.g. ['xhr','http','fetch']),
// not a function. Resolve it eagerly via the public getAdapter() helper so the
// override below can actually chain — otherwise every non-offline-eligible
// request TypeErrors inside the async adapter and the page's try/catch swallows
// it as a generic "Something went wrong" toast (network tab stays empty).
// ─── MP-DIAGNOSTIC INSTRUMENT (support tool) ───────────────────────────
// Surfaces the offline write decision + any thrown error to an on-screen
// banner. HIDDEN by default; enabled via the 5-tap version reveal in
// Settings (sets localStorage 'mp-debug'='1'). console.error always fires
// (visible in adb logcat); the banner only renders in debug mode. Tap the
// banner to dismiss it. Kept as a permanent field-support lever.
let _mpDiagSeq = 0;
function mpDiag(text) {
  try { console.error("[MP-DIAG]", text); } catch { /* noop */ }
  if (typeof document === "undefined") return;
  try { if (localStorage.getItem("mp-debug") !== "1") return; } catch { return; }
  try {
    let el = document.getElementById("mp-diag-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "mp-diag-banner";
      el.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#111;" +
        "color:#0f0;font:12px/1.45 monospace;padding:8px 10px;white-space:pre-wrap;" +
        "max-height:45vh;overflow:auto;border-top:2px solid #0f0;";
      el.addEventListener("click", () => { try { el.remove(); } catch { /* noop */ } });
      document.body.appendChild(el);
    }
    _mpDiagSeq += 1;
    el.textContent = `MP-DIAG #${_mpDiagSeq} (tap to close)\n${text}`;
  } catch {
    try { window.alert("MP-DIAG\n" + text); } catch { /* noop */ }
  }
}

const _originalAdapter = axios.getAdapter(api.defaults.adapter);
api.defaults.adapter = async function offlineAwareAdapter(config) {
  if (isOfflineEligible(config.method, config.url)) {
    const _diagPath = `${(config.method || "POST").toUpperCase()} ${(config.url || "").replace(BASE_URL, "").split("?")[0]}`;
    let net;
    try {
      net = await getNetworkStatus();
    } catch (e) {
      net = { connected: true, degraded: false };
      // MP-DIAG: getNetworkStatus itself threw → we wrongly assume online.
      mpDiag(`WRITE ${_diagPath}\ngetNetworkStatus() THREW: ${e?.name}: ${e?.message}\n=> defaulted connected=true (will hit network)`);
    }
    // MP-DEGRADED-ROUTING (Paul, 1 Jun): route writes via the queue
    // path not only when fully offline, but also when network.js
    // reports "degraded" (a recent ping or write attempt failed,
    // navigator still says online). Trades "this write might have
    // succeeded on the real network" for "the cashier sees an
    // instant Queued · will sync toast instead of waiting up to
    // 45s on a spinner before the response interceptor catches and
    // enqueues anyway." See network.js's MP-DEGRADED-ROUTING
    // comment for the threshold rationale.
    if (!net.connected || net.degraded) {
      const payload = typeof config.data === "string" ? safeJson(config.data) : (config.data || {});
      const localId = payload.local_id || genLocalId();
      payload.local_id = localId;
      payload.is_offline = true;   // audit flag: this write was queued offline (survives replay verbatim)
      const endpoint = (config.url || "").replace(BASE_URL, "");
      try {
        await enqueue({ endpoint, method: (config.method || "POST").toUpperCase(), payload });
        // MP-DIAG: hypothesis (b) FALSE — the native queue write succeeded.
        mpDiag(`WRITE ${_diagPath}\nDETECT connected=${net.connected} degraded=${net.degraded} src=${net.source}\n=> ENQUEUED OK ✓ (offline queue is working)`);
        return buildOptimisticResponse(endpoint, payload, localId);
      } catch (e) {
        // MP-PHASE-4 BUG-2 DIAGNOSTIC: surface SQLite/queue failures on
        // the offline pre-flight path. Without this, an enqueue throw
        // (e.g. @capacitor-community/sqlite plugin not initialised, or
        // pending_sync table not created) propagates as a generic axios
        // rejection that the response interceptor then silently swallows
        // — the cashier sees "Network error. Retry." with no log trail.
        // Logged at error level so Chrome devtools WebView debugging
        // surfaces it. Re-throw so the response interceptor still gets
        // its chance to enqueue via the secondary path.
        console.error("[offlineAwareAdapter enqueue threw]", {
          endpoint, method: config.method,
          error: e?.message || String(e), stack: e?.stack,
        });
        // MP-DIAG: hypothesis (b) TRUE — the native storage layer is throwing.
        mpDiag(`WRITE ${_diagPath}\nDETECT connected=${net.connected} degraded=${net.degraded} src=${net.source}\n=> ENQUEUE THREW ✗: ${e?.name}: ${e?.message}\n(THIS IS THE BUG — native SQLite/storage layer)`);
        throw e;
      }
    }
    // MP-DIAG: adapter decided "online" → real network. In an airplane-mode
    // test this verdict is itself the anomaly (hypothesis a), so surface it.
    mpDiag(`WRITE ${_diagPath}\nDETECT connected=${net.connected} degraded=${net.degraded} src=${net.source}\n=> ROUTED TO NETWORK (adapter thinks online)`);
  }
  return _originalAdapter(config);
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

api.interceptors.response.use(res => {
  // MP-DEGRADED-ROUTING: a successful 2xx on an offline-eligible write
  // path is a vote of confidence that the network is healthy. Decrement
  // _writeAttemptFailures (clamps at 0 in network.js) so the degraded
  // flag clears when enough writes succeed in a row. Reads aren't a
  // useful signal — they bypass the offline queue entirely.
  try {
    if (isOfflineEligible(res?.config?.method, res?.config?.url)) {
      recordWriteSuccess();
    }
  } catch { /* noop */ }
  return res;
}, async err => {
  // MP-CAPACITOR Slice 3: 5xx on an offline-eligible write → enqueue
  // for replay so a transient backend hiccup doesn't lose the cashier's
  // action. Network errors (no response) also enqueue. 4xx still bubbles
  // — those are validation errors the user needs to see now.
  const cfg = err.config || {};
  if (isOfflineEligible(cfg.method, cfg.url)) {
    const isNetworkErr = !err.response;
    const is5xx = err.response && err.response.status >= 500;
    if (isNetworkErr || is5xx) {
      try {
        const payload = typeof cfg.data === "string" ? safeJson(cfg.data) : (cfg.data || {});
        const localId = payload.local_id || genLocalId();
        payload.local_id = localId;
        payload.is_offline = true;   // real network failed → queued; tag for audit
        const endpoint = (cfg.url || "").replace(BASE_URL, "");
        await enqueue({ endpoint, method: (cfg.method || "POST").toUpperCase(), payload });
        // MP-DEGRADED-ROUTING: the real network just failed on an
        // offline-eligible write. Increment the degraded counter so
        // the NEXT write skips the network and goes straight to the
        // queue, sparing the cashier another 45s spinner cycle.
        // Cleared by a successful 2xx on a subsequent write.
        try { recordWriteFailure(); } catch { /* noop */ }
        // MP-DIAG: pre-flight missed offline but the safety net caught the
        // network error and queued the write — detection lagged, storage OK.
        mpDiag(`RESP-FALLBACK ${(cfg.method || "").toUpperCase()} ${endpoint}\nnetwork err: ${err?.message}\n=> SALVAGED via queue ✓ (detection missed offline, storage OK)`);
        return Promise.resolve(buildOptimisticResponse(endpoint, payload, localId));
      } catch (e) {
        // MP-PHASE-4 BUG-2 DIAGNOSTIC: surface queue failures on the
        // response-interceptor fallback path. Was a bare `catch {}`
        // that fell through to bubble the original network error —
        // the cashier sees "Network error. Retry." and we have no log
        // trail. Capture before fall-through so the next failure is
        // actionable from Chrome devtools WebView debugging.
        console.error("[response-interceptor enqueue threw]", {
          endpoint: (cfg.url || "").replace(BASE_URL, ""),
          method: cfg.method,
          original_error: err?.message || String(err),
          enqueue_error: e?.message || String(e),
          enqueue_stack: e?.stack,
        });
        // MP-DIAG: both pre-flight AND safety-net enqueue threw → the
        // cashier sees "Network error. Retry." Native storage is the cause.
        mpDiag(`RESP-FALLBACK ${(cfg.method || "").toUpperCase()} ${(cfg.url || "").replace(BASE_URL, "")}\nnetwork err: ${err?.message}\n=> ENQUEUE THREW ✗: ${e?.name}: ${e?.message}\n(THIS IS THE BUG — native SQLite/storage layer)`);
        /* fall through to error bubble */
      }
    }
  }
  // MP-OWNER-PIN-APPROVAL: distinguish session-invalid 401s (auth
  // middleware rejected the Bearer token) from authorisation-flow 401s
  // (approval / consume RPC said no). Approval-flow paths return a
  // structured `error` code; let the originating component handle them
  // (show "Wrong PIN", "Token expired", etc.) WITHOUT logging the
  // cashier out. On native APK the previous unconditional logout fired
  // before the modal's catch could surface a "Wrong PIN" message,
  // dumping cashiers to /login mid-flow.
  const APPROVAL_ERRORS = new Set([
    "invalid_pin", "token_required", "approval_failed", "consume_failed",
    "bad_pin_format", "bad_action", "missing_target", "entry_not_found",
    "entry_not_pending", "rate_limited",
  ]);
  if (err.response?.status === 401 && !APPROVAL_ERRORS.has(err.response?.data?.error)) {
    useAuthStore.getState().logout();
    window.location.href = "/login";
  }
  // Sprint A: any 403 with { error: 'upgrade_required' } pops the universal
  // PaywallModal. Layout listens for this event so individual pages don't
  // each have to handle the response shape. Rejection still propagates so
  // local error handlers can stay tight if they want to.
  // MP-REQUIRE-OPEN-SHIFT Phase 3: backend gates every money-event
  // POST with 400 { code:"NO_OPEN_SHIFT", message:"Ouvrez votre…" }
  // when the caller has no open pa_cash_shifts row. Rewrite the
  // message in-place to the user's language so the dozens of
  // existing `toast.error(err.response?.data?.message || "Error")`
  // handlers across pages surface the right text — no per-page
  // special-case needed. The proactive blocker card + disabled
  // submit buttons cover the happy path; this is the backstop for
  // a cashier who clicks faster than the 30s shift-status refetch
  // (or whose shift was closed from another device mid-action).
  if (err.response?.status === 400 && err.response?.data?.code === "NO_OPEN_SHIFT") {
    try {
      const lang = useLangStore.getState().lang;
      err.response.data.message = lang === "fr"
        ? "Ouvrez votre caisse avant de continuer."
        : "Open your shift before continuing.";
    } catch (_) { /* SSR / store not initialised */ }
  }
  if (err.response?.status === 403 && err.response?.data?.error === "upgrade_required") {
    const d = err.response.data;
    try {
      window.dispatchEvent(new CustomEvent("partenaire:paywall", {
        detail: {
          feature:      d.feature,
          current_plan: d.current_plan,
          current_count: d.current_count,
          cap:           d.cap
        }
      }));
    } catch (_) { /* SSR / no-window env */ }
  }
  // MP-TRIAL-EXPIRY-RESTRICTION: a blocked write on a restricted (expired/unpaid
  // trial) org → fire one app-wide event so Layout shows the "trial ended —
  // upgrade" prompt + routes to /request-activation, instead of a raw error toast.
  if (err.response?.status === 403 && err.response?.data?.code === "subscription_restricted") {
    try {
      window.dispatchEvent(new CustomEvent("partenaire:restricted", { detail: err.response.data }));
    } catch (_) { /* SSR / no-window env */ }
  }
  return Promise.reject(err);
});

export default api;

// MP-CURRENCY-DISPLAY: legacy formatCFA removed — money now formats per-org via
// useCurrency()/formatMoney(amount, org.currency). See utils/currency.js.

export const formatDate = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const getGreeting = (lang = "en") => {
  const h = new Date().getHours();
  if (lang === "fr") return h < 12 ? "Bonjour" : h < 18 ? "Bon apres-midi" : "Bonsoir";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
