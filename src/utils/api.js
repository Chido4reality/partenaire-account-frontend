import axios from "axios";
import { useAuthStore, useLangStore } from "../store";
import { enqueue, configureSync, startWorker, genLocalId } from "./pendingSync";
import { getNetworkStatus } from "./network";

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
// /returns/{return,exchange,void}/:saleId are the three return-flow
// shapes; all three go through the same backend handler (processReturn
// or void_sale RPC) that supports local_id idempotency.
const OFFLINE_ELIGIBLE = [
  { rx: /^\/sales\/?$/,                            method: "POST" },
  { rx: /^\/sales\/[^/]+\/payment\/?$/,            method: "POST" },
  { rx: /^\/returns\/(return|exchange|void)\/[^/]+\/?$/, method: "POST" },
  { rx: /^\/expenditures\/?$/,                     method: "POST" },
  // MP-PHASE-4.2: actual backend route is /api/transfers (not /stock-transfers).
  // The misnamed regex meant offline transfers fell through to the network and
  // 6s-hung. Backend already dedupes by local_id (transfers.js + syncDedupe),
  // so the queue is replay-safe end-to-end.
  { rx: /^\/transfers\/?$/,                         method: "POST" },
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
  // Offline-eligible writes keep the generous 15s ceiling: they enqueue on
  // failure, so giving a slow-but-up backend longer to ack avoids a premature
  // optimistic-queue fallback. Reads/auth stay on the 6s default (fail fast).
  if (isOfflineEligible(config.method, config.url)) config.timeout = 15000;
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
const _originalAdapter = axios.getAdapter(api.defaults.adapter);
api.defaults.adapter = async function offlineAwareAdapter(config) {
  if (isOfflineEligible(config.method, config.url)) {
    let net;
    try { net = await getNetworkStatus(); } catch { net = { connected: true }; }
    if (!net.connected) {
      const payload = typeof config.data === "string" ? safeJson(config.data) : (config.data || {});
      const localId = payload.local_id || genLocalId();
      payload.local_id = localId;
      const endpoint = (config.url || "").replace(BASE_URL, "");
      try {
        await enqueue({ endpoint, method: (config.method || "POST").toUpperCase(), payload });
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
        throw e;
      }
    }
  }
  return _originalAdapter(config);
};

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

api.interceptors.response.use(res => res, async err => {
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
        const endpoint = (cfg.url || "").replace(BASE_URL, "");
        await enqueue({ endpoint, method: (cfg.method || "POST").toUpperCase(), payload });
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
  return Promise.reject(err);
});

export default api;

export const formatCFA = (amount) => {
  if (!amount && amount !== 0) return "—";
  return new Intl.NumberFormat("fr-CM").format(Math.round(amount)) + " FCFA";
};

export const formatDate = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const getGreeting = (lang = "en") => {
  const h = new Date().getHours();
  if (lang === "fr") return h < 12 ? "Bonjour" : h < 18 ? "Bon apres-midi" : "Bonsoir";
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
