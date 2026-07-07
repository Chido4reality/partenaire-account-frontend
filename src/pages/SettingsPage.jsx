import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { useAuthStore, useLangStore, useSettingsStore } from "../store";
import api from "../utils/api";
import { useCurrency } from "../utils/useCurrency";
import PaywallModal from "../components/common/PaywallModal";
import { hasFeature, getCapabilities } from "../utils/planCapabilities";
import { useLiteMode } from "../hooks/useLiteMode";
import { useTrialState } from "../hooks/useTrialState";

const ROLES = [
  { value: "cashier",    en: "Cashier",    fr: "Caissier",     color: "#94a3b8" },
  { value: "manager",    en: "Manager",    fr: "Gestionnaire", color: "#818cf8" },
  { value: "warehouse",  en: "Warehouse",  fr: "Magasinier",   color: "#34d399" },
  // Accountant Log (Phase 1): a literate helper who runs the app for the boss.
  // Same broad operational access as a manager, but never staff management,
  // billing, or the Accountant Log itself.
  { value: "accountant", en: "Accountant", fr: "Comptable",    color: "#22d3ee" },
  { value: "owner",      en: "Owner",      fr: "Propriétaire", color: "#fbbf24" },
];

const roleStyle = (role) => {
  const r = ROLES.find(x => x.value === role);
  return { color: r?.color || "#94a3b8", bg: (r?.color || "#94a3b8") + "20" };
};

// MP-PROPLUS-CASHIER-LOCATION: only send assigned_location_id when the org has
// the Pro Plus capability. Otherwise omit it entirely so a non-Pro-Plus owner
// editing a staff member (or a downgraded org) never trips the server's
// upgrade-required gate, and a previously-set assignment is left untouched.
function buildStaffPayload(form, effectivePlan) {
  const p = { full_name: form.full_name, phone: form.phone, password: form.password, role: form.role };
  if (hasFeature(effectivePlan, "staff_location_binding")) {
    p.assigned_location_id = form.assigned_location_id || null;
  }
  return p;
}

// Staff Maintenance Phase 1 — blank form incl HR-lite fields. Basic fields
// (name/phone/password/role) work on every plan; the HR-lite fields are only
// shown/saved for a Pro Plus owner.
const BLANK_STAFF = {
  full_name: "", phone: "", password: "", role: "cashier", assigned_location_id: "",
  // HR-lite
  job_title: "", hire_date: "", employment_type: "", salary_amount: "",
  salary_period: "per_month", salary_currency: "XAF",
  emergency_contact_name: "", emergency_contact_phone: "", national_id: "", notes: "",
  // photo state: existing url, a pending new data-URL, and a remove flag
  photo_url: "", _photoData: "", _photoRemove: false,
};

const EMP_TYPES = [
  { value: "full_time", en: "Full-time", fr: "Temps plein" },
  { value: "part_time", en: "Part-time", fr: "Temps partiel" },
  { value: "contract",  en: "Contract",  fr: "Contrat" },
  { value: "casual",    en: "Casual",    fr: "Occasionnel" },
];

// Client-side downscale + JPEG compress so low-connectivity shops upload small
// photos (≈ max 512px, quality 0.7). Returns a data URL.
function compressImageFile(file, maxDim = 512, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// MP-DEBUG-REVEAL (3 Jun): 5 quick taps on the version footer toggle
// 'mp-debug' in localStorage, which un-hides the offline diagnostic banner
// (api.js mpDiag). Classic Android dev-menu reveal — invisible to normal
// users, a permanent support lever for field debugging.
let _debugTaps = { count: 0, t: 0 };

export default function SettingsPage() {
  const { user, org } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const { selectedLocation, setLocation } = useSettingsStore();
  const qc = useQueryClient();
  const fmt = useCurrency();
  const isOwner = user?.role === "owner";
  const handleVersionTap = () => {
    const now = Date.now();
    if (now - _debugTaps.t > 2000) _debugTaps.count = 0;
    _debugTaps.t = now;
    _debugTaps.count += 1;
    if (_debugTaps.count >= 5) {
      _debugTaps.count = 0;
      let on = false;
      try { on = localStorage.getItem("mp-debug") === "1"; } catch { /* ignore */ }
      try {
        if (on) { localStorage.removeItem("mp-debug"); document.getElementById("mp-diag-banner")?.remove(); }
        else { localStorage.setItem("mp-debug", "1"); }
      } catch { /* ignore */ }
      toast(on ? (lang === "fr" ? "Mode debug désactivé" : "Debug mode OFF")
               : (lang === "fr" ? "Mode debug activé" : "Debug mode ON"));
    }
  };
  // MP-LITE-MODE-PHASE-1: source of truth for the toggle's current value.
  // The Mode tab below renders only for owner; the toggle POSTs to
  // /auth/lite-mode and updates authStore.org.lite_mode inline so the
  // whole app re-renders without a /auth/me round-trip.
  const lite = useLiteMode();
  const trial = useTrialState();
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const flipMode = async () => {
    setModeSaving(true);
    const targetEnabled = !lite ? true : false; // Full(lite=false) → Simple(true); Simple(lite=true) → Full(false)
    try {
      await api.post("/auth/lite-mode", { enabled: targetEnabled });
      // MP-MODE-TRIAL-REWORK: App Mode is a pure view toggle — no trial is
      // stamped. Just reflect the new view in authStore.org.
      const curr = useAuthStore.getState().org || {};
      useAuthStore.setState({ org: { ...curr, lite_mode: targetEnabled } });
      toast.success(targetEnabled
        ? (lang === "en" ? "✓ Switched to Simple view" : "✓ Vue simple activée")
        : (lang === "en" ? "✓ Switched to Full view" : "✓ Vue complète activée"));
      setShowModeConfirm(false);
    } catch (e) {
      // MP-MODE-TRIAL-REWORK: trial expired & unpaid → 402 NEEDS_SUBSCRIPTION.
      // Open the subscription/payment form instead of erroring.
      const code = e?.response?.data?.code;
      if (code === "NEEDS_SUBSCRIPTION" || e?.response?.status === 402) {
        setShowModeConfirm(false);
        window.dispatchEvent(new CustomEvent("mp-open-upgrade"));
      } else {
        toast.error(e?.response?.data?.message || "Error");
      }
    } finally { setModeSaving(false); }
  };

  const [tab, setTab] = useState("locations");

  // Location state
  const [showAddLoc, setShowAddLoc] = useState(false);
  const [editLoc, setEditLoc]       = useState(null);
  const [locForm, setLocForm]       = useState({ name: "", type: "shop", address: "", phone: "" });

  // Staff state
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [editStaff, setEditStaff]       = useState(null);
  const [staffForm, setStaffForm]       = useState({ ...BLANK_STAFF });
  // Phase 2 — per-staff Activity view (read-only, owner + Pro Plus).
  const [activityPeriod, setActivityPeriod] = useState("this_month");
  // Team attendance (consolidated roster) — owner + Pro Plus. Period values match
  // the GET /staff/attendance/team query params (today|week|month|all).
  const [teamPeriod, setTeamPeriod] = useState("month");
  const [teamSort, setTeamSort] = useState("hours"); // 'hours' (desc) | 'name'

  // Shop settings state
  const [shopForm, setShopForm] = useState({
    name: "", slogan: "", email: "", phone: "", address: "", city: "", country: "Cameroun",
    whatsapp_number: "", receipt_footer: "", receipt_advert_enabled: true, receipt_code_style: "auto", daily_summary_time: "17:30",
    daily_summary_enabled: true, low_stock_alerts_enabled: true,
    drawer_mode: "shared",
    whatsapp_alerts_addon: false,
    transfer_receipt_confirmation_enabled: false,
    transfer_require_second_person: true,
    cashier_undo_requires_approval: true
  });
  // MP-WHATSAPP-ALERTS: per-month add-on fee (read-only, from mp_pricing_config
  // via GET /settings) + the org currency, for the billing toggle label.
  const [waAlertsFee, setWaAlertsFee] = useState(0);
  const [waAlertsCur, setWaAlertsCur] = useState("XAF");
  const [pinForm, setPinForm]     = useState({ current_pin: "", new_pin: "", confirm_pin: "" });
  const [showPinSection, setShowPinSection] = useState(false);
  const [pinError, setPinError]   = useState("");
  const [shopLoaded, setShopLoaded] = useState(false);

  // Dozie state
  const [dozieForm, setDozieForm] = useState({ dozie_pin: "", city: "Douala", shop_description: "" });
  // MP-DOZIE-ACTIVATE-UI: dedicated PIN-only form used by both
  // State B (linked-but-no-PIN) and State C "Change PIN" affordance.
  // Separate from dozieForm so we don't carry stale city/description
  // through the PIN-only path.
  const [doziePinForm, setDoziePinForm] = useState({ new_pin: "", confirm_pin: "" });
  const [showChangeDoziePin, setShowChangeDoziePin] = useState(false);
  const [doziePinError, setDoziePinError] = useState("");
  // MP-DOZIE-PIN-VISIBLE: reveal toggle for the seller's current Dozie
  // login PIN (returned by /dozie/status for the owner). Hidden by default.
  const [revealDoziePin, setRevealDoziePin] = useState(false);

  // Sprint A: enable unconditionally — we use my-plan for the branding
  // gate and Dozie city restrictions, so it must be available on every
  // tab, not just the Dozie tab.
  const { data: planData } = useQuery({
    queryKey: ["my-plan"],
    queryFn: () => api.get("/subscriptions/my-plan").then(r => r.data)
  });
  const myPlan = planData?.data;
  const trialActive = myPlan?.trial_active;
  const planId = myPlan?.plan_id;
  const effectivePlan = myPlan?.effective_plan || "silver";
  const canBrand = hasFeature(effectivePlan, "receipt_branding");
  const [brandingPaywall, setBrandingPaywall] = useState(false);
  const isSilverBlocked = planId === "silver" && !trialActive;
  const isGoldTier = planId === "gold" || (planId === "silver" && trialActive);

  // ── QUERIES ────────────────────────────────────────────────────────────────
  const { data: locData } = useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data)
  });

  const { data: staffData, isLoading: staffLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get("/auth/staff").then(r => r.data),
    enabled: tab === "staff"
  });

  // Phase 2 — read-only Activity for the staffer being edited (owner + Pro Plus).
  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ["staff-activity", editStaff?.id, activityPeriod],
    queryFn: () => api.get(`/staff/${editStaff.id}/activity?period=${activityPeriod}`).then(r => r.data),
    enabled: !!editStaff && isOwner && hasFeature(effectivePlan, "staff_maintenance"),
  });

  // Phase 3 — read-only Attendance records (same period control as Activity).
  const { data: attendanceData, isLoading: attendanceLoading } = useQuery({
    queryKey: ["staff-attendance", editStaff?.id, activityPeriod],
    queryFn: () => api.get(`/staff/${editStaff.id}/attendance?period=${activityPeriod}`).then(r => r.data),
    enabled: !!editStaff && isOwner && hasFeature(effectivePlan, "staff_maintenance"),
  });

  // Team attendance — consolidated roster for the period (owner + Pro Plus).
  // 30s poll so the "clocked in now" indicator stays fresh while the tab is open.
  const { data: teamAttData, isLoading: teamAttLoading } = useQuery({
    queryKey: ["staff-attendance-team", teamPeriod],
    queryFn: () => api.get(`/staff/attendance/team?period=${teamPeriod}`).then(r => r.data),
    enabled: tab === "staff" && isOwner && hasFeature(effectivePlan, "staff_maintenance"),
    refetchInterval: 30000,
  });

  // MP-SETTINGS-WIPE-BUG: React Query v5 removed the `onSuccess`
  // callback from useQuery. The previous code relied on it to
  // populate shopForm from the server response — so the callback
  // never fired, the form stayed at its empty defaults from
  // useState, and Save would PATCH "" for every text field,
  // wiping the DB. The v5-correct pattern is a useEffect watching
  // the query data. shopLoaded guard preserves the original
  // "populate once, then don't clobber user edits" semantics.
  const { data: shopResp } = useQuery({
    queryKey: ["org-settings"],
    queryFn: () => api.get("/settings").then(r => r.data),
    // MP-CITY-UNIFY: also needed in the Dozie tab to show the (single) shop city.
    enabled: tab === "shop" || tab === "dozie",
  });

  const { data: cityResp } = useQuery({
    queryKey: ["cities", shopForm.country],
    queryFn: () => api.get(`/cities?country=${encodeURIComponent(shopForm.country || "Cameroun")}`).then(r => r.data),
    enabled: tab === "shop",
  });
  const cityOptions = cityResp?.data || [];
  // MP-CITY-UNIFY: the shop's city is the single source of truth — the Dozie
  // seller city follows it (mirrored server-side). The separate Dozie city
  // picker + /cities/dozie query were removed; the city below is read-only.
  const dozieShopCity = shopResp?.data?.city || "";
  useEffect(() => {
    const d = shopResp?.data;
    if (!d || shopLoaded) return;
    setShopForm({
      name:                     d.name || "",
      slogan:                   d.slogan || "",
      email:                    d.email || "",
      phone:                    d.phone || "",
      address:                  d.address || "",
      city:                     d.city || "",
      country:                  d.country || "Cameroun",
      whatsapp_number:          d.whatsapp_number || "",
      receipt_footer:           d.receipt_footer || "",
      receipt_advert_enabled:   d.receipt_advert_enabled ?? true,
      receipt_code_style:       d.receipt_code_style || "auto",
      daily_summary_time:       d.daily_summary_time || "17:30",
      daily_summary_enabled:    d.daily_summary_enabled ?? true,
      low_stock_alerts_enabled: d.low_stock_alerts_enabled ?? true,
      drawer_mode:              d.drawer_mode || "shared",
      whatsapp_alerts_addon:    d.whatsapp_alerts_addon === true,
      transfer_receipt_confirmation_enabled: d.transfer_receipt_confirmation_enabled === true,
      transfer_require_second_person: d.transfer_require_second_person !== false,
      cashier_undo_requires_approval: d.cashier_undo_requires_approval !== false,
    });
    setWaAlertsFee(Number(d.whatsapp_alerts_fee) || 0);
    setWaAlertsCur(d.currency || "XAF");
    setShopLoaded(true);
  }, [shopResp, shopLoaded]);

  // MP-DRAWER-MODE-TOGGLE: open shifts in the org gate the
  // drawer_mode flip. Enabled only on the shop tab (the only place
  // the radio lives). Backend 409 is the authoritative check; this
  // is the UX guard so the user doesn't try-and-fail.
  const { data: openShiftsResp } = useQuery({
    queryKey: ["shifts-open-in-org"],
    queryFn: () => api.get("/shifts/open-in-org").then(r => r.data),
    enabled: tab === "shop" && isOwner,
    refetchInterval: 15000,
  });
  const openShifts = openShiftsResp?.data?.shifts || [];
  const savedDrawerMode = shopResp?.data?.drawer_mode || "shared";
  const drawerModeChanged = shopForm.drawer_mode !== savedDrawerMode;
  const drawerModeBlocked = drawerModeChanged && openShifts.length > 0;

  // ── LOCATION MUTATIONS ─────────────────────────────────────────────────────
  const addLocMutation = useMutation({
    mutationFn: () => api.post("/locations", locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Location added!" : "Emplacement ajouté!");
      setShowAddLoc(false);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateLocMutation = useMutation({
    mutationFn: () => api.patch("/locations/" + editLoc.id, locForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "Updated!" : "Mis à jour!");
      setEditLoc(null);
      setLocForm({ name: "", type: "shop", address: "", phone: "" });
      qc.invalidateQueries(["locations"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── STAFF MUTATIONS ────────────────────────────────────────────────────────
  // Whether the HR-lite enrichment applies (Pro Plus + owner). Basic
  // create/edit always runs via /auth/users for every plan/role.
  const canHrLite = isOwner && hasFeature(effectivePlan, "staff_maintenance");

  // Persist the HR-lite profile + photo for a known user id. No-op unless
  // entitled. Runs AFTER the basic /auth/users write so the user row exists.
  async function persistHrLite(userId) {
    if (!canHrLite || !userId) return;
    await api.put("/staff/" + userId + "/profile", {
      job_title: staffForm.job_title || null,
      hire_date: staffForm.hire_date || null,
      employment_type: staffForm.employment_type || null,
      salary_amount: staffForm.salary_amount === "" ? null : staffForm.salary_amount,
      salary_period: staffForm.salary_period || null,
      salary_currency: staffForm.salary_currency || null,
      emergency_contact_name: staffForm.emergency_contact_name || null,
      emergency_contact_phone: staffForm.emergency_contact_phone || null,
      national_id: staffForm.national_id || null,
      notes: staffForm.notes || null,
    });
    if (staffForm._photoData) {
      await api.post("/staff/" + userId + "/photo", { image: staffForm._photoData });
    } else if (staffForm._photoRemove && staffForm.photo_url) {
      await api.delete("/staff/" + userId + "/photo");
    }
  }

  const addStaffMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post("/auth/users", buildStaffPayload(staffForm, effectivePlan));
      const newId = res?.data?.data?.id;
      await persistHrLite(newId);
      return res;
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff member added!" : "Personnel ajouté!");
      setShowAddStaff(false);
      setStaffForm({ ...BLANK_STAFF });
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const updateStaffMutation = useMutation({
    mutationFn: async () => {
      await api.patch("/auth/users/" + editStaff.id, buildStaffPayload(staffForm, effectivePlan));
      await persistHrLite(editStaff.id);
    },
    onSuccess: () => {
      toast.success(lang === "en" ? "Staff updated!" : "Personnel mis à jour!");
      setEditStaff(null);
      setStaffForm({ ...BLANK_STAFF });
      qc.invalidateQueries(["staff"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const deactivateStaffMutation = useMutation({
    mutationFn: (id) => api.delete("/auth/users/" + id),
    onSuccess: () => { toast.success(lang === "en" ? "Staff deactivated!" : "Personnel désactivé!"); qc.invalidateQueries(["staff"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const reactivateStaffMutation = useMutation({
    mutationFn: (id) => api.patch("/auth/users/" + id, { is_active: true }),
    onSuccess: () => { toast.success(lang === "en" ? "Staff reactivated!" : "Personnel réactivé!"); qc.invalidateQueries(["staff"]); },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // ── SHOP SETTINGS MUTATIONS ────────────────────────────────────────────────
  const saveShopMutation = useMutation({
    mutationFn: () => api.patch("/settings", shopForm),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Settings saved!" : "✓ Paramètres sauvegardés!", { duration: 3000 });
      qc.invalidateQueries(["org-settings"]);
      // Mode flip changes shift-resolution semantics across the
      // app; invalidate current-shift + open-in-org so the
      // indicator and warning panel reflect the new mode.
      qc.invalidateQueries({ queryKey: ["current-shift"] });
      qc.invalidateQueries({ queryKey: ["shifts-open-in-org"] });
    },
    onError: (err) => {
      const d = err.response?.data;
      if (err.response?.status === 409 && d?.code === "SHIFTS_STILL_OPEN") {
        qc.invalidateQueries({ queryKey: ["shifts-open-in-org"] });
      }
      toast.error(d?.message || "Error");
    }
  });

  const pinMutation = useMutation({
    mutationFn: () => api.post("/settings/set-pin", { current_pin: pinForm.current_pin || null, new_pin: pinForm.new_pin }),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ PIN updated!" : "✓ PIN mis à jour!");
      setPinForm({ current_pin: "", new_pin: "", confirm_pin: "" });
      setShowPinSection(false); setPinError("");
    },
    onError: (err) => setPinError(err.response?.data?.message || "Error")
  });

  const handlePinSave = () => {
    if (pinForm.new_pin.length !== 4) { setPinError(lang === "en" ? "PIN must be exactly 4 digits" : "PIN doit être exactement 4 chiffres"); return; }
    if (pinForm.new_pin !== pinForm.confirm_pin) { setPinError(lang === "en" ? "PINs don't match" : "Les PIN ne correspondent pas"); return; }
    setPinError(""); pinMutation.mutate();
  };

  // ── DOZIE QUERIES & MUTATIONS ─────────────────────────────────────────────
  const { data: dozieStatusData, isLoading: dozieLoading } = useQuery({
    queryKey: ["dozie-status"],
    queryFn: () => api.get("/dozie/status").then(r => r.data),
    enabled: tab === "dozie" && isOwner
  });
  const dozieStatus = dozieStatusData?.data;
  // FU.5 — pause/reopen entire Dozie shop. Same backend logic as the
  // seller HTML's toggle, but resolved through the MP-authenticated
  // /api/dozie/shop-pause endpoint (linked_mp_org_id → seller id).
  const shopPaused = dozieStatus?.identity?.status === "paused";
  const pauseShopMutation = useMutation({
    mutationFn: () => api.post("/dozie/shop-pause"),
    onSuccess: () => {
      toast.success(lang === "en" ? "⏸ Dozie shop paused" : "⏸ Boutique Dozie en pause");
      qc.invalidateQueries(["dozie-status"]);
    },
    onError: (err) => {
      const d = err.response?.data || {};
      if (err.response?.status === 409 && d.pending_count) {
        toast.error(lang === "en"
          ? `${d.pending_count} pending order(s) — settle before pausing`
          : `${d.pending_count} commande(s) en cours — réglez-les d'abord`);
      } else {
        toast.error(d.message || "Error");
      }
    }
  });
  const reopenShopMutation = useMutation({
    mutationFn: () => api.post("/dozie/shop-reopen"),
    onSuccess: () => {
      toast.success(lang === "en" ? "✓ Dozie shop reopened" : "✓ Boutique Dozie rouverte");
      qc.invalidateQueries(["dozie-status"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  const activateDozieMutation = useMutation({
    mutationFn: () => api.post("/dozie/activate", dozieForm),
    onSuccess: (res) => {
      toast.success(lang === "en" ? "✓ Linked to Partenaire Dozie!" : "✓ Lié à Partenaire Dozie!");
      qc.invalidateQueries(["dozie-status"]);
    },
    onError: (err) => toast.error(err.response?.data?.message || "Error")
  });

  // MP-DOZIE-ACTIVATE-UI: PIN-only mutation. Used by State B
  // (initial PIN set on auto-linked org) and State C Change PIN.
  // Backend /dozie/activate handles both via its SAME-ORG branch —
  // sends back mode: "initial_pin_set" | "pin_changed" so we can
  // localize the toast.
  const setDoziePinMutation = useMutation({
    mutationFn: () => api.post("/dozie/activate", { dozie_pin: doziePinForm.new_pin }),
    onSuccess: (res) => {
      const mode = res?.data?.data?.mode;
      const msg = mode === "pin_changed"
        ? (lang === "en" ? "✓ Dozie PIN updated" : "✓ PIN Dozie mis à jour")
        : (lang === "en" ? "✓ Dozie PIN set — you can now sell on Partenaire Dozie" : "✓ PIN Dozie défini — vous pouvez vendre sur Partenaire Dozie");
      toast.success(msg);
      setDoziePinForm({ new_pin: "", confirm_pin: "" });
      setShowChangeDoziePin(false);
      setDoziePinError("");
      qc.invalidateQueries(["dozie-status"]);
    },
    onError: (err) => setDoziePinError(err.response?.data?.message || "Error")
  });

  const handleDoziePinSave = () => {
    if (doziePinForm.new_pin.length !== 4 || !/^\d{4}$/.test(doziePinForm.new_pin)) {
      setDoziePinError(lang === "en" ? "PIN must be exactly 4 digits" : "PIN doit être exactement 4 chiffres");
      return;
    }
    if (doziePinForm.new_pin !== doziePinForm.confirm_pin) {
      setDoziePinError(lang === "en" ? "PINs don't match" : "Les PIN ne correspondent pas");
      return;
    }
    setDoziePinError("");
    setDoziePinMutation.mutate();
  };

  const locations = locData?.data || [];
  const staff = staffData?.data || [];
  const activeStaff = staff.filter(s => s.is_active);
  const inactiveStaff = staff.filter(s => !s.is_active);

  const openEdit = (loc) => { setEditLoc(loc); setLocForm({ name: loc.name, type: loc.type, address: loc.address || "", phone: loc.phone || "" }); };
  const openEditStaff = async (s) => {
    setEditStaff(s);
    // Seed basics immediately (so the modal renders without waiting).
    setStaffForm({
      ...BLANK_STAFF,
      full_name: s.full_name, phone: s.phone, password: "", role: s.role,
      assigned_location_id: s.assigned_location_id || "",
      photo_url: s.photo_url || "",
    });
    // Owner + Pro Plus: fetch the full HR-lite profile (incl owner-only
    // national_id / salary) and merge it in. Managers / non-Pro-Plus skip this
    // (the endpoint is owner+Pro-Plus gated) and only see the basic fields.
    if (isOwner && hasFeature(effectivePlan, "staff_maintenance")) {
      try {
        const r = await api.get("/staff/" + s.id + "/profile");
        const p = r.data?.data;
        if (p) setStaffForm(f => ({
          ...f,
          job_title: p.job_title || "",
          hire_date: p.hire_date || "",
          employment_type: p.employment_type || "",
          salary_amount: p.salary_amount ?? "",
          salary_period: p.salary_period || "per_month",
          salary_currency: p.salary_currency || "XAF",
          emergency_contact_name: p.emergency_contact_name || "",
          emergency_contact_phone: p.emergency_contact_phone || "",
          national_id: p.national_id || "",
          notes: p.notes || "",
          photo_url: p.photo_url || s.photo_url || "",
        }));
      } catch (e) { /* non-fatal: keep basics */ }
    }
  };
  const setLF = (k, v) => setLocForm(f => ({ ...f, [k]: v }));
  const setSF = (k, v) => setStaffForm(f => ({ ...f, [k]: v }));
  const setFF = (k, v) => setShopForm(f => ({ ...f, [k]: v }));

  // FACTURE letterhead logo. Branding is Premium-gated (logo_url), so a
  // non-Premium org gets the paywall. The picked image is downscaled to a small
  // PNG data URL (max 320px) so it stays light enough to live in the org row +
  // ride along in every /settings response, and renders directly in the
  // printed letterhead <img>. No separate upload endpoint needed.
  const handleLogoFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!canBrand) { setBrandingPaywall(true); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const max = 320;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try { setFF("logo_url", canvas.toDataURL("image/png")); }
        catch { setFF("logo_url", ev.target.result); }
      };
      img.onerror = () => setFF("logo_url", ev.target.result);
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const TABS = [
    { key: "locations", en: "Warehouses & Shops", fr: "Magasins & Boutiques" },
    { key: "staff",     en: "Staff",              fr: "Personnel" },
    { key: "shop",      en: "Shop Settings",      fr: "Paramètres boutique", ownerOnly: true },
    { key: "account",   en: "Account",            fr: "Compte" },
    // MP-LITE-MODE-PHASE-1: owner-only Mode tab. In Lite, Partenaire
    // Dozie tab is hidden too (would expose Marketplace controls the
    // toggle was supposed to suppress); the Mode tab itself stays so
    // the owner can opt back into Pro.
    { key: "mode",      en: "Mode",               fr: "Mode",                ownerOnly: true },
    { key: "dozie",     en: "Partenaire Dozie",   fr: "Partenaire Dozie",    ownerOnly: true, hideInLite: true },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{lang === "en" ? "Settings" : "Paramètres"}</h1>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        {TABS.filter(tb => (!tb.ownerOnly || isOwner) && !(lite && tb.hideInLite)).map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            style={{ padding: "10px 20px", background: "none", border: "none", borderBottom: tab === tb.key ? "2px solid var(--brand)" : "2px solid transparent", color: tab === tb.key ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", fontSize: 13, fontWeight: tab === tb.key ? 600 : 400, marginBottom: -1 }}>
            {lang === "en" ? tb.en : tb.fr}
          </button>
        ))}
      </div>

      {/* ══ LOCATIONS TAB ══════════════════════════════════════════════════════ */}
      {tab === "locations" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{lang === "en" ? "Your Warehouses & Shops" : "Vos Magasins & Boutiques"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{lang === "en" ? "Manage your selling locations and warehouses" : "Gérez vos emplacements de vente et entrepôts"}</div>
            </div>
            {isOwner && (
              <button className="btn btn-primary" onClick={() => setShowAddLoc(true)}>+ {lang === "en" ? "Add location" : "Ajouter emplacement"}</button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {locations.map(loc => {
              const isActive = selectedLocation?.id === loc.id;
              return (
                <div key={loc.id} style={{ background: "var(--bg-card)", border: `1px solid ${isActive ? "var(--brand)" : "var(--border)"}`, borderRadius: 12, padding: "16px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: loc.type === "warehouse" ? "rgba(251,197,3,0.15)" : "rgba(16,185,129,0.15)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, flexShrink: 0 }}>
                    {loc.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{loc.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                      <span style={{ background: loc.type === "warehouse" ? "rgba(251,197,3,0.12)" : "rgba(16,185,129,0.12)", color: loc.type === "warehouse" ? "var(--brand-light)" : "#34d399", padding: "1px 8px", borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{loc.type}</span>
                      {loc.address && <span>{loc.address}</span>}
                      {loc.phone && <span>{loc.phone}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {isActive ? (
                      <span style={{ fontSize: 11, background: "rgba(16,185,129,0.15)", color: "#34d399", padding: "4px 12px", borderRadius: 20, fontWeight: 600 }}>✓ {lang === "en" ? "Active" : "Actif"}</span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => setLocation(loc)}>
                        {lang === "en" ? "Set active" : "Activer"}
                      </button>
                    )}
                    {isOwner && (
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(loc)}>
                        {lang === "en" ? "Edit" : "Modifier"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ STAFF TAB ══════════════════════════════════════════════════════════ */}
      {tab === "staff" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{lang === "en" ? "Staff Members" : "Membres du personnel"}</div>
            {(isOwner || user?.role === "manager") && (
              <button className="btn btn-primary" onClick={() => setShowAddStaff(true)}>+ {lang === "en" ? "Add staff" : "Ajouter"}</button>
            )}
          </div>

          {/* Team attendance — consolidated roster (owner + Pro Plus). The
              per-worker detail (Settings → edit staff → Attendance) is unchanged;
              tapping a row here deep-links into it. */}
          {isOwner && hasFeature(effectivePlan, "staff_maintenance") && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>🕒 {lang === "en" ? "Team attendance" : "Présence de l'équipe"}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: (teamAttData?.data?.currently_clocked_in_count || 0) > 0 ? "#34d399" : "var(--text-muted)" }}>
                  <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: (teamAttData?.data?.currently_clocked_in_count || 0) > 0 ? "#34d399" : "var(--text-muted)", marginRight: 6 }} />
                  {(teamAttData?.data?.currently_clocked_in_count || 0)} {lang === "en" ? "clocked in now" : "pointés maintenant"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {[["today", "Today", "Aujourd'hui"], ["week", "This week", "Cette semaine"], ["month", "This month", "Ce mois"], ["all", "All", "Tout"]].map(([v, en, fr]) => (
                  <button key={v} className={teamPeriod === v ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setTeamPeriod(v)}>{lang === "en" ? en : fr}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, fontSize: 12, color: "var(--text-muted)", alignItems: "center" }}>
                <span>{lang === "en" ? "Sort:" : "Tri :"}</span>
                <button className={teamSort === "hours" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setTeamSort("hours")}>{lang === "en" ? "Hours" : "Heures"}</button>
                <button className={teamSort === "name" ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} onClick={() => setTeamSort("name")}>{lang === "en" ? "Name" : "Nom"}</button>
              </div>
              {teamAttLoading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{lang === "en" ? "Loading…" : "Chargement…"}</div>
              ) : (() => {
                const list = [...(teamAttData?.data?.staff || [])].sort((a, b) =>
                  teamSort === "name"
                    ? (a.name || "").localeCompare(b.name || "")
                    : ((b.total_hours || 0) - (a.total_hours || 0)) || (a.name || "").localeCompare(b.name || ""));
                if (!list.length) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{lang === "en" ? "No staff." : "Aucun personnel."}</div>;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {list.map(r => {
                      const rs = roleStyle(r.role);
                      const full = activeStaff.find(x => x.id === r.user_id);
                      return (
                        <div key={r.user_id} onClick={() => full && openEditStaff(full)}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 8, cursor: full ? "pointer" : "default" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                            {r.currently_clocked_in && <span title={lang === "en" ? "clocked in now" : "pointé maintenant"} style={{ width: 8, height: 8, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />}
                            <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                            <span style={{ fontSize: 10, padding: "1px 8px", borderRadius: 10, background: rs.bg, color: rs.color, fontWeight: 600, flexShrink: 0 }}>
                              {ROLES.find(x => x.value === r.role)?.[lang === "en" ? "en" : "fr"] || r.role}</span>
                            {r.currently_clocked_in && <span style={{ fontSize: 10, fontWeight: 800, color: "#34d399" }}>ON</span>}
                          </div>
                          <div style={{ minWidth: 64, textAlign: "right" }}>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.total_hours ?? 0} h</div>
                            {r.currently_clocked_in && (r.open_session_hours || 0) > 0 && (
                              <div style={{ fontSize: 10, color: "#34d399", fontWeight: 600 }}>
                                {lang === "en" ? `incl. ${r.open_session_hours}h live` : `dont ${r.open_session_hours}h en cours`}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {staffLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeStaff.map(s => {
                const rs = roleStyle(s.role);
                return (
                  // MP-MOBILE-UI: deterministic stack. The previous
                  // flex-wrap fallback (57d4b0a) depended on intrinsic
                  // widths and let rows collapse to ~100px name/phone
                  // when the actions block barely fit inline. Now the
                  // avatar+name+phone group has w-full on mobile so
                  // it occupies the whole row, FORCING the actions
                  // block to wrap to a new line. md+ restores the
                  // inline layout via md:w-auto + md:flex-1.
                  <div key={s.id} className="flex flex-wrap items-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", gap: 14 }}>
                    <div className="flex items-center gap-3.5 w-full md:w-auto md:flex-1 min-w-0">
                      <div style={{ width: 38, height: 38, borderRadius: 10, overflow: "hidden", background: rs.bg, color: rs.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                        {s.photo_url
                          ? <img src={s.photo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : (s.full_name?.charAt(0)?.toUpperCase())}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.full_name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.phone}</div>
                        {/* MP-PROPLUS-CASHIER-LOCATION: show the pinned home location (Pro Plus). */}
                        {s.assigned_location_name && (
                          <div style={{ fontSize: 11, color: "var(--brand-light)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📍 {s.assigned_location_name}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap" style={{ flexShrink: 0 }}>
                      <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 12, background: rs.bg, color: rs.color, fontWeight: 600 }}>
                        {ROLES.find(r => r.value === s.role)?.[lang === "en" ? "en" : "fr"] || s.role}
                      </span>
                      {(isOwner || user?.role === "manager") && s.id !== user?.id && (
                        <>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditStaff(s)}>
                            {lang === "en" ? "Edit" : "Modifier"}
                          </button>
                          <button onClick={() => deactivateStaffMutation.mutate(s.id)}
                            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
                            {lang === "en" ? "Deactivate" : "Désactiver"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {inactiveStaff.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {lang === "en" ? "Inactive" : "Inactifs"}
                  </div>
                  {inactiveStaff.map(s => {
                    const rs = roleStyle(s.role);
                    return (
                      // MP-MOBILE-UI: same deterministic stack as the
                      // active row above (avatar+name group takes w-full
                      // on mobile, forcing the Reactivate button to wrap
                      // to a new line).
                      <div key={s.id} className="flex flex-wrap items-center" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", gap: 14, opacity: 0.6, marginBottom: 8 }}>
                        <div className="flex items-center gap-3.5 w-full md:w-auto md:flex-1 min-w-0">
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: rs.bg, color: rs.color, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                            {s.full_name?.charAt(0)?.toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.full_name}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.phone}</div>
                          </div>
                        </div>
                        {isOwner && (
                          <button onClick={() => reactivateStaffMutation.mutate(s.id)}
                            style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                            ✅ {lang === "en" ? "Reactivate" : "Réactiver"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {staff.length === 0 && (
                <div className="empty-state">
                  <div style={{ fontWeight: 600 }}>{lang === "en" ? "No staff members yet" : "Aucun personnel"}</div>
                </div>
              )}
            </div>
          )}

          {/* Role info box */}
          <div style={{ marginTop: 20, padding: 16, background: "rgba(251,197,3,0.08)", border: "1px solid rgba(251,197,3,0.2)", borderRadius: 12, fontSize: 13, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>{lang === "en" ? "Staff roles:" : "Rôles du personnel:"}</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {ROLES.filter(r => r.value !== "owner").map(r => (
                <div key={r.value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 8, background: r.color + "20", color: r.color, fontWeight: 600, minWidth: 80, textAlign: "center" }}>{lang === "en" ? r.en : r.fr}</span>
                  <span style={{ fontSize: 12 }}>
                    {r.value === "cashier" && (lang === "en" ? "POS sales only, no inventory access" : "Ventes POS uniquement, pas d'accès inventaire")}
                    {r.value === "manager" && (lang === "en" ? "Sales + inventory + staff management" : "Ventes + inventaire + gestion personnel")}
                    {r.value === "warehouse" && (lang === "en" ? "Stock management only, no prices visible" : "Gestion du stock uniquement, prix masqués")}
                    {r.value === "accountant" && (lang === "en" ? "Runs the app like a manager, but no staff or billing access" : "Gère l'app comme un gestionnaire, sans accès personnel ni facturation")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ SHOP SETTINGS TAB (owner only) ════════════════════════════════════ */}
      {tab === "shop" && isOwner && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Shop Info */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>🏪 {lang === "en" ? "Shop Information" : "Informations boutique"}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Shop name" : "Nom de la boutique"} *</label>
                <input className="input" value={shopForm.name} onChange={e => setFF("name", e.target.value)} placeholder="Ex: Dozie Store" />
              </div>
              {/* FACTURE letterhead: slogan shows under the business name. */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">{lang === "en" ? "Slogan" : "Slogan"}</label>
                <input className="input" value={shopForm.slogan} onChange={e => setFF("slogan", e.target.value)} placeholder={lang === "en" ? "Your shop tagline (shown on invoices)" : "Slogan de la boutique (affiché sur les factures)"} />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label>
                <input className="input" value={shopForm.phone} onChange={e => setFF("phone", e.target.value)} placeholder="6XXXXXXXX" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "E-mail" : "E-mail"}</label>
                <input className="input" type="email" value={shopForm.email} onChange={e => setFF("email", e.target.value)} placeholder="boutique@exemple.com" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Owner WhatsApp number" : "WhatsApp du propriétaire"}</label>
                <input className="input" value={shopForm.whatsapp_number} onChange={e => setFF("whatsapp_number", e.target.value)} placeholder="237XXXXXXXXX" />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en"
                    ? "Receives the daily report when shifts are closed. Include country code (237 for Cameroon)."
                    : "Reçoit le rapport quotidien à la fermeture du poste. Inclure l'indicatif (237 pour Cameroun)."}
                </div>
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
                <input className="input" value={shopForm.address} onChange={e => setFF("address", e.target.value)} placeholder="Ex: Nouvelle route, Bonaberri" />
              </div>
              <div className="form-group">
                <label className="label">{lang === "en" ? "City" : "Ville"}</label>
                <select className="input" value={shopForm.city} onChange={e => setFF("city", e.target.value)}>
                  <option value="">{lang === "en" ? "Select city…" : "Choisir la ville…"}</option>
                  {shopForm.city && !cityOptions.includes(shopForm.city) && (
                    <option value={shopForm.city}>{shopForm.city} {lang === "en" ? "(current)" : "(actuel)"}</option>
                  )}
                  {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* FACTURE letterhead logo (Premium-gated, like receipt branding). */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lang === "en" ? "Logo (invoice letterhead)" : "Logo (en-tête de facture)"}
                  {!canBrand && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 700 }}>🔒 Premium</span>
                  )}
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {shopForm.logo_url
                    ? <img src={shopForm.logo_url} alt="logo" style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)", background: "#fff" }} />
                    : <div style={{ width: 56, height: 56, borderRadius: 8, border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "var(--text-muted)" }}>🏪</div>}
                  <label style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    {lang === "en" ? "Upload logo" : "Choisir un logo"}
                    <input type="file" accept="image/*" onChange={handleLogoFile} style={{ display: "none" }} />
                  </label>
                  {shopForm.logo_url && (
                    <button type="button" onClick={() => setFF("logo_url", "")}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(248,113,113,0.4)", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                      {lang === "en" ? "Remove" : "Retirer"}
                    </button>
                  )}
                </div>
              </div>
              {/* MP-DRAWER-MODE-TOGGLE: drawer mode radio. Spans full
                  width. Save is disabled (with a warning) when the
                  selection differs from saved value AND shifts are
                  still open in the org — flipping mid-shift would
                  produce a mismatched shift-resolution scope. */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label">
                  {lang === "en" ? "Cash drawer mode" : "Mode de caisse"}
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                  {[
                    { value: "shared",       en: "Shared drawer",       fr: "Caisse partagée",
                      enHint: "Recommended — one physical till, multiple cashiers share it (one daily count)",
                      frHint: "Recommandé — une seule caisse physique partagée par plusieurs caissiers (un seul comptage par jour)" },
                    { value: "per_cashier",  en: "Per-cashier drawer",  fr: "Caisse par caissier",
                      enHint: "Each cashier has their own till at this location (multiple drawers in parallel)",
                      frHint: "Chaque caissier dispose de sa propre caisse (plusieurs tiroirs en parallèle)" },
                  ].map(opt => {
                    const checked = shopForm.drawer_mode === opt.value;
                    return (
                      <label key={opt.value}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                          background: checked ? "rgba(251,197,3,0.10)" : "var(--bg-elevated)",
                          border: `1px solid ${checked ? "rgba(251,197,3,0.40)" : "var(--border)"}`,
                          transition: "background 0.15s, border-color 0.15s",
                        }}>
                        <input type="radio" name="drawer_mode"
                          checked={checked}
                          onChange={() => setFF("drawer_mode", opt.value)}
                          style={{ marginTop: 3 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>
                            {lang === "en" ? opt.en : opt.fr}
                            {opt.value === savedDrawerMode && (
                              <span style={{ marginLeft: 8, fontSize: 10, padding: "1px 8px", borderRadius: 8, background: "rgba(16,185,129,0.15)", color: "#34d399", fontWeight: 700 }}>
                                {lang === "en" ? "Current" : "Actuel"}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>
                            {lang === "en" ? opt.enHint : opt.frHint}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {drawerModeBlocked && (
                  <div style={{
                    marginTop: 10,
                    background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.35)",
                    borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#fbbf24",
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      ⚠ {lang === "en"
                        ? "Close all open shifts before changing this setting."
                        : "Fermez tous les postes ouverts avant de changer ce paramètre."}
                    </div>
                    <div style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {lang === "en" ? "Open shifts: " : "Postes ouverts : "}
                      <strong>
                        {openShifts.map(s => s.cashier_name || "?").join(", ")}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              {/* Sprint A: receipt_footer is part of receipt_branding —
                  Premium only. Non-Premium plans see the input disabled
                  with a lock badge; click opens the paywall modal. */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lang === "en" ? "Receipt footer" : "Message bas de reçu"}
                  {!canBrand && (
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24", fontWeight: 700 }}>
                      🔒 {lang === "en" ? "Premium" : "Premium"}
                    </span>
                  )}
                </label>
                <input className="input"
                  value={shopForm.receipt_footer}
                  onChange={e => canBrand ? setFF("receipt_footer", e.target.value) : null}
                  onClick={() => { if (!canBrand) setBrandingPaywall(true); }}
                  readOnly={!canBrand}
                  style={!canBrand ? { opacity: 0.6, cursor: "pointer" } : {}}
                  placeholder={lang === "en" ? "Thank you for your business!" : "Merci pour votre confiance!"} />
                {!canBrand && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {lang === "en" ? "Custom receipt branding is a Premium feature." : "La personnalisation du reçu est réservée au plan Premium."}
                  </div>
                )}
              </div>

              {/* MP-RECEIPT-ADVERT: per-org toggle for the "Powered by Mon
                  Partenaire" advert at the bottom of receipts. Default ON. */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Show Mon Partenaire advert on receipts" : "Afficher la pub Mon Partenaire sur les reçus"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en"
                      ? "A small \"Powered by Mon Partenaire\" line at the very bottom of each receipt."
                      : "Une petite ligne « Propulsé par Mon Partenaire » tout en bas de chaque reçu."}</div>
                  </div>
                  <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", flexShrink: 0 }}>
                    <input type="checkbox" checked={shopForm.receipt_advert_enabled} onChange={e => setFF("receipt_advert_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                    <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.receipt_advert_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                      <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.receipt_advert_enabled ? 23 : 3, transition: "0.2s" }} />
                    </span>
                  </label>
                </div>
              </div>

              {/* MP-RECEIPT-CODE-STYLE (Fix 1): which scannable return-lookup code
                  prints on receipts. Automatic = by currency (Cameroon→QR,
                  Nigeria→barcode). */}
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{lang === "en" ? "Receipt scan code" : "Code à scanner sur le reçu"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>{lang === "en"
                    ? "The code printed for scanning a receipt back for a return. Barcode suits 1D laser scanners (common in Nigeria); QR scans best on phone cameras."
                    : "Le code imprimé pour scanner un reçu lors d'un retour. Le code-barres convient aux scanners laser 1D (courants au Nigeria) ; le QR se scanne mieux à la caméra."}</div>
                  <select className="input" value={shopForm.receipt_code_style || "auto"} onChange={e => setFF("receipt_code_style", e.target.value)}>
                    <option value="auto">{lang === "en" ? "Automatic (by country)" : "Automatique (selon le pays)"}</option>
                    <option value="barcode">{lang === "en" ? "Barcode (CODE128)" : "Code-barres (CODE128)"}</option>
                    <option value="qr">{lang === "en" ? "QR code" : "Code QR"}</option>
                    <option value="both">{lang === "en" ? "Both (barcode + QR)" : "Les deux (code-barres + QR)"}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* WhatsApp Alerts */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>📱 {lang === "en" ? "WhatsApp Alerts" : "Alertes WhatsApp"}</div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Auto-send daily report" : "Envoi auto rapport du jour"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en"
                  ? "Prompts WhatsApp send to owner when a shift is closed"
                  : "Propose l'envoi WhatsApp au propriétaire à la fermeture d'un poste"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={shopForm.daily_summary_enabled} onChange={e => setFF("daily_summary_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.daily_summary_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.daily_summary_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>
            {/* MP-REPORT-SIMPLIFY-AND-AUTOSEND: the previous "Send time"
                input drove the 17:30 cron that has been disabled.
                Trigger is now shift-close, not a scheduled time, so
                the input is hidden. daily_summary_time stays in the
                schema for safety in case rollback is needed. */}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Low stock alerts" : "Alertes stock bas"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{lang === "en" ? "Toggle per product in Inventory" : "Activez par produit dans Inventaire"}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }}>
                <input type="checkbox" checked={shopForm.low_stock_alerts_enabled} onChange={e => setFF("low_stock_alerts_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.low_stock_alerts_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.low_stock_alerts_enabled ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>

            {/* MP-TRANSFER-RECEIVE-CONFIRM (Phase 1): Pro/Pro Plus opt-in. ON → a
                transfer must be Dispatched by the sender then Confirmed at the
                destination before stock lands (stops warehouse-vs-shop disputes).
                OFF → today's instant one-tap complete. Only shown on Pro/Pro Plus. */}
            {["pro", "pro_plus"].includes(effectivePlan) && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10 }}>
                <div style={{ maxWidth: 300 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Transfer receive-confirmation" : "Confirmation de réception des transferts"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en"
                      ? "The destination must confirm what arrived before stock is added. Sender dispatches, receiver confirms."
                      : "La destination doit confirmer ce qui est arrivé avant l'ajout du stock. L'expéditeur envoie, le récepteur confirme."}
                  </div>
                </div>
                <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", flexShrink: 0 }}>
                  <input type="checkbox" checked={shopForm.transfer_receipt_confirmation_enabled} onChange={e => setFF("transfer_receipt_confirmation_enabled", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.transfer_receipt_confirmation_enabled ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                    <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.transfer_receipt_confirmation_enabled ? 23 : 3, transition: "0.2s" }} />
                  </span>
                </label>
              </div>
            )}

            {/* MP-TRANSFER-RECEIVE-CONFIRM (Phase 2, Part 3): require a DIFFERENT person
                to confirm. Only relevant when confirmation is on; one-person shops turn
                it off to sign both ends themselves. Nested under the confirmation toggle. */}
            {["pro", "pro_plus"].includes(effectivePlan) && shopForm.transfer_receipt_confirmation_enabled && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginLeft: 16, borderLeft: "2px solid var(--border)" }}>
                <div style={{ maxWidth: 300 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Require a different person to confirm" : "Exiger une autre personne pour confirmer"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en"
                      ? "Turn off for one-person shops (sign both ends yourself)."
                      : "Désactivez pour les boutiques à une personne (signez les deux étapes vous-même)."}
                  </div>
                </div>
                <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", flexShrink: 0 }}>
                  <input type="checkbox" checked={shopForm.transfer_require_second_person} onChange={e => setFF("transfer_require_second_person", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.transfer_require_second_person ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                    <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.transfer_require_second_person ? 23 : 3, transition: "0.2s" }} />
                  </span>
                </label>
              </div>
            )}

            {/* MP-UNDO-TO-CART: let cashiers undo their OWN recent sale (30-min/same-shift
                window) WITHOUT owner/manager approval. OFF by default (approval required).
                Toggle is the INVERSE of the stored cashier_undo_requires_approval flag.
                Owner-only tab; Pro/Pro Plus (undo is a Pro feature). */}
            {["pro", "pro_plus"].includes(effectivePlan) && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10 }}>
                <div style={{ maxWidth: 300 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{lang === "en" ? "Let cashiers undo their own recent sale without approval" : "Laisser les caissiers annuler leur vente récente sans approbation"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {lang === "en"
                      ? "Only their own sale, within 30 min, same shift. Still fully recorded. Off = owner/manager approval required."
                      : "Uniquement leur propre vente, sous 30 min, même poste. Toujours enregistré. Désactivé = approbation requise."}
                  </div>
                </div>
                <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", flexShrink: 0 }}>
                  <input type="checkbox" checked={!shopForm.cashier_undo_requires_approval} onChange={e => setFF("cashier_undo_requires_approval", !e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                  <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: !shopForm.cashier_undo_requires_approval ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                    <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: !shopForm.cashier_undo_requires_approval ? 23 : 3, transition: "0.2s" }} />
                  </span>
                </label>
              </div>
            )}

            {/* MP-WHATSAPP-ALERTS: paid add-on (owner billing toggle). Turning it
                on adds the monthly fee to the NEXT subscription bill (plan
                discounts never apply to it). The alerts themselves stay inert
                until the global WHATSAPP_ALERTS_ENABLED flag is on server-side —
                so this only governs entitlement + billing, never live sends. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "var(--bg-elevated)", borderRadius: 10, marginTop: 12 }}>
              <div style={{ paddingRight: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {lang === "en" ? "WhatsApp instant alerts" : "Alertes WhatsApp instantanées"}
                  {waAlertsFee > 0 && (
                    <span style={{ color: "var(--brand)", fontWeight: 700 }}>
                      {" "}+{Math.round(waAlertsFee).toLocaleString("en-US").replace(/,/g, " ")} {waAlertsCur}/{lang === "en" ? "mo" : "mois"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{lang === "en"
                  ? "Shift close + staff oversight, up to 5/day. Billed on your next subscription."
                  : "Fermeture de caisse + surveillance du personnel, jusqu'à 5/jour. Facturé sur votre prochain abonnement."}</div>
              </div>
              <label style={{ position: "relative", width: 44, height: 24, cursor: "pointer", flexShrink: 0 }}>
                <input type="checkbox" checked={shopForm.whatsapp_alerts_addon} onChange={e => setFF("whatsapp_alerts_addon", e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: 12, background: shopForm.whatsapp_alerts_addon ? "var(--brand)" : "var(--border)", transition: "0.2s" }}>
                  <span style={{ position: "absolute", width: 18, height: 18, borderRadius: "50%", background: "#fff", top: 3, left: shopForm.whatsapp_alerts_addon ? 23 : 3, transition: "0.2s" }} />
                </span>
              </label>
            </div>
            {shopForm.whatsapp_alerts_addon && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, padding: "0 4px" }}>
                {lang === "en"
                  ? "✓ The add-on fee will be added to your next subscription charge."
                  : "✓ Les frais de l'option seront ajoutés à votre prochain paiement d'abonnement."}
              </div>
            )}
          </div>

          {/* Owner PIN */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showPinSection ? 20 : 0 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>🔐 {lang === "en" ? "Owner PIN" : "PIN propriétaire"}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {lang === "en" ? "Override prices and approve voids/returns" : "Forcer les prix et approuver les annulations"}
                </div>
              </div>
              <button onClick={() => setShowPinSection(!showPinSection)}
                style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                {showPinSection ? (lang === "en" ? "Cancel" : "Annuler") : (lang === "en" ? "Set PIN" : "Définir PIN")}
              </button>
            </div>

            {showPinSection && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "Current PIN" : "PIN actuel"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.current_pin} onChange={e => setPinForm(f => ({ ...f, current_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "New PIN" : "Nouveau PIN"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.new_pin} onChange={e => setPinForm(f => ({ ...f, new_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                  <div className="form-group">
                    <label className="label">{lang === "en" ? "Confirm PIN" : "Confirmer"}</label>
                    <input className="input" type="password" inputMode="numeric" maxLength={4}
                      value={pinForm.confirm_pin} onChange={e => setPinForm(f => ({ ...f, confirm_pin: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                      placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                  </div>
                </div>
                {pinError && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{pinError}</div>}
                <button onClick={handlePinSave} disabled={pinMutation.isPending} className="btn btn-primary" style={{ minWidth: 160 }}>
                  {pinMutation.isPending ? "..." : (lang === "en" ? "Save PIN" : "Sauvegarder PIN")}
                </button>
              </div>
            )}
          </div>

          {/* Save button */}
          <button onClick={() => saveShopMutation.mutate()}
            disabled={saveShopMutation.isPending || drawerModeBlocked}
            className="btn btn-primary" style={{ height: 48, fontSize: 15, fontWeight: 700 }}>
            {saveShopMutation.isPending
              ? "..."
              : drawerModeBlocked
                ? (lang === "en" ? "🔒 Close shifts to save" : "🔒 Fermez les postes pour sauvegarder")
                : (lang === "en" ? "✓ Save Settings" : "✓ Sauvegarder")}
          </button>
        </div>
      )}

      {/* ══ ACCOUNT TAB ════════════════════════════════════════════════════════ */}
      {tab === "account" && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>{lang === "en" ? "Account Information" : "Informations du compte"}</div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { label: lang === "en" ? "Business name" : "Nom de la boutique", value: org?.name },
              { label: lang === "en" ? "Your name" : "Votre nom", value: user?.full_name },
              { label: lang === "en" ? "Phone" : "Téléphone", value: user?.phone },
              { label: "Role", value: ROLES.find(r => r.value === user?.role)?.[lang === "en" ? "en" : "fr"] || user?.role },
            ].map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{item.label}</span>
                <span style={{ fontWeight: 500, fontSize: 13 }}>{item.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => setLang(lang === "en" ? "fr" : "en")}>
              🌐 {lang === "en" ? "Switch to Français" : "Switch to English"}
            </button>
            {/* MP-RESTRICTED-MODE (B2): subscription entry point — always reachable. */}
            <Link to="/request-activation" className="btn btn-primary" style={{ textDecoration: "none" }}>
              💳 {lang === "en" ? "Manage subscription" : "Gérer l'abonnement"}
            </Link>
          </div>
        </div>
      )}

      {/* ══ MODE TAB (Lite / Pro) ═════════════════════════════════════════════
          MP-LITE-MODE-PHASE-1: owner-only switch between simplified
          (Lite) and full-feature (Pro) UI. Confirms before flipping
          so a misclick doesn't silently demote a Pro user. */}
      {tab === "mode" && isOwner && (
        <div>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>
              {lang === "en" ? "App Mode" : "Mode de l'application"}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.55 }}>
              {lang === "en"
                ? "Simple view hides advanced surfaces (Notifications, Marketplace, Operations dashboard, by-location reports, bulk Transfers) so the app stays simple for day-to-day till work. Full view reveals everything. You can switch back at any time."
                : "La Vue simple masque les surfaces avancées (Notifications, Marché, Tableau opérations, rapports par site, transferts en lot) pour garder l'application simple pour le travail quotidien à la caisse. La Vue complète révèle tout. Vous pouvez basculer à tout moment."}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{
                flex: "1 1 240px",
                background: lite ? "rgba(16,185,129,0.10)" : "var(--bg-elevated)",
                border: `1px solid ${lite ? "rgba(16,185,129,0.45)" : "var(--border)"}`,
                borderRadius: 12, padding: "14px 16px",
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  {lite ? "✓ " : ""}{lang === "en" ? "Simple view" : "Vue simple"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {lang === "en" ? "Currently active" : "Actuellement actif"}{lite ? "" : (lang === "en" ? " when toggled on" : " si activé")}
                </div>
              </div>
              <div style={{
                flex: "1 1 240px",
                background: !lite ? "rgba(251,197,3,0.12)" : "var(--bg-elevated)",
                border: `1px solid ${!lite ? "rgba(251,197,3,0.45)" : "var(--border)"}`,
                borderRadius: 12, padding: "14px 16px",
              }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  {!lite ? "✓ " : ""}{lang === "en" ? "Full view" : "Vue complète"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {!lite ? (lang === "en" ? "Currently active" : "Actuellement actif") : (lang === "en" ? "Full feature set" : "Toutes les fonctionnalités")}
                </div>
              </div>
            </div>
            {/* MP-MODE-TRIAL-REWORK: context note under the two cards. */}
            {lite && trial.trial_active && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 10, fontSize: 12, color: "#fbbf24" }}>
                ⏳ {lang === "en"
                  ? `Free trial active — ${trial.trial_days_remaining} day${trial.trial_days_remaining === 1 ? '' : 's'} left. You have full access; switching views is free. Subscribe before it ends to keep Full view.`
                  : `Essai gratuit actif — ${trial.trial_days_remaining} jour${trial.trial_days_remaining === 1 ? '' : 's'} restant${trial.trial_days_remaining === 1 ? '' : 's'}. Accès complet ; changer de vue est gratuit. Abonnez-vous avant la fin pour garder la Vue complète.`}
              </div>
            )}
            {lite && !trial.can_use_full_view && (
              <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 10, fontSize: 12, color: "#f87171" }}>
                🔒 {lang === "en"
                  ? "Your free trial has ended. Full view requires a subscription (Lite, Pro or Pro Plus)."
                  : "Votre essai gratuit est terminé. La Vue complète nécessite un abonnement (Lite, Pro ou Pro Plus)."}
              </div>
            )}
            {/* CTA — context-aware. Simple→Full: free switch if entitled (trial or
                paid), else opens the payment/subscription form. Full→Simple: always free. */}
            <button
              onClick={() => {
                if (!lite) { setShowModeConfirm(true); return; }            // Full → Simple
                if (trial.can_use_full_view) { setShowModeConfirm(true); }  // Simple → Full (entitled)
                else { window.dispatchEvent(new CustomEvent("mp-open-upgrade")); } // → payment
              }}
              disabled={modeSaving}
              className="btn btn-primary"
              style={{ marginTop: 20, fontWeight: 700 }}>
              {lite
                ? (lang === "en" ? "Switch to Full view" : "Passer à la Vue complète")
                : (lang === "en" ? "Switch to Simple view" : "Passer à la Vue simple")}
            </button>
          </div>
        </div>
      )}

      {/* Confirm modal for Mode switch. Inline rather than a shared
          shell so the copy can be specific. */}
      {showModeConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3500, padding: 16 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 420, padding: 24 }}>
            <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 10 }}>
              {lite
                ? (lang === "en" ? "Switch to Full view?" : "Passer à la Vue complète ?")
                : (lang === "en" ? "Switch to Simple view?" : "Passer à la Vue simple ?")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 18 }}>
              {lite
                ? (lang === "en"
                    ? "Full view reveals Notifications, Marketplace, Operations dashboard, by-location reports, and bulk Transfers. You can return to Simple at any time."
                    : "La Vue complète révèle Notifications, Marché, Tableau opérations, rapports par site et transferts en lot. Vous pouvez revenir à la Vue simple à tout moment.")
                : (lang === "en"
                    ? "Simple view hides advanced surfaces so the app stays simple. Day-to-day till work is unaffected. You can return to Full at any time."
                    : "La Vue simple masque les surfaces avancées pour garder l'application simple. Le travail quotidien à la caisse n'est pas affecté. Vous pouvez revenir à la Vue complète à tout moment.")}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} disabled={modeSaving} onClick={() => setShowModeConfirm(false)}>
                {lang === "en" ? "Cancel" : "Annuler"}
              </button>
              <button className="btn btn-primary" style={{ flex: 1, fontWeight: 700 }} disabled={modeSaving} onClick={flipMode}>
                {modeSaving ? "..." : (lang === "en" ? "Confirm" : "Confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ PARTENAIRE DOZIE TAB ══════════════════════════════════════════════ */}
      {tab === "dozie" && (
        <div>
          <div style={{ background: "linear-gradient(135deg, rgba(201,168,76,0.12), rgba(26,43,74,0.3))", border: "1px solid rgba(201,168,76,0.3)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 32 }}>✦</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>Partenaire Dozie</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {lang === "en" ? "Wholesale & B2B marketplace" : "Marché de gros & B2B"}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              {lang === "en"
                ? "Connect your Mon Partenaire account to Partenaire Dozie. Your products will be listed for wholesale buyers, and you can log in to Dozie using your phone number."
                : "Connectez votre compte Mon Partenaire à Partenaire Dozie. Vos produits seront listés pour les acheteurs en gros, et vous pourrez vous connecter à Dozie avec votre numéro de téléphone."}
            </div>
          </div>

          {dozieLoading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Loading...</div>
          ) : isSilverBlocked ? (
            <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 16, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                {lang === "en" ? "Gold or Premium required" : "Gold ou Premium requis"}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.6 }}>
                {lang === "en"
                  ? "Partenaire Dozie is available on Gold (3 cities) and Premium (all cities) plans."
                  : "Partenaire Dozie est disponible sur les plans Gold (3 villes) et Premium (toutes les villes)."}
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", fontSize: 12, marginBottom: 16 }}>
                <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "8px 14px", color: "#f59e0b" }}>
                  🥇 Gold — Douala, Yaoundé, Bafoussam
                </div>
                <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 8, padding: "8px 14px", color: "#fbbf24" }}>
                  💎 Premium — {lang === "en" ? "All cities" : "Toutes les villes"}
                </div>
              </div>
            </div>
          ) : dozieStatus?.activated && !dozieStatus?.has_pin ? (
            /* ── State B: auto-linked, owner needs to set a PIN ── */
            <div style={{ background: "var(--bg-card)", border: "1px solid rgba(251,197,3,0.35)", borderRadius: 16, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 28 }}>🔑</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    {lang === "en"
                      ? "Set your Dozie PIN"
                      : "Définissez votre PIN Dozie"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>
                    {lang === "en"
                      ? "Your shop is already connected to Partenaire Dozie. Set a 4-digit PIN to start selling."
                      : "Votre boutique est déjà connectée à Partenaire Dozie. Définissez un PIN à 4 chiffres pour commencer à vendre."}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "New PIN (4 digits)" : "Nouveau PIN (4 chiffres)"}</label>
                  <input className="input" type="password" inputMode="numeric" maxLength={4}
                    value={doziePinForm.new_pin}
                    onChange={e => setDoziePinForm(f => ({ ...f, new_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                    placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} autoFocus />
                </div>
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Confirm PIN" : "Confirmer le PIN"}</label>
                  <input className="input" type="password" inputMode="numeric" maxLength={4}
                    value={doziePinForm.confirm_pin}
                    onChange={e => setDoziePinForm(f => ({ ...f, confirm_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                    onKeyDown={e => { if (e.key === "Enter") handleDoziePinSave(); }}
                    placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                </div>
              </div>

              {doziePinError && (
                <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{doziePinError}</div>
              )}

              <button className="btn btn-primary"
                style={{ width: "100%", height: 46, marginTop: 8 }}
                disabled={doziePinForm.new_pin.length !== 4 || setDoziePinMutation.isPending}
                onClick={handleDoziePinSave}>
                {setDoziePinMutation.isPending
                  ? "..."
                  : (lang === "en" ? "✦ Set PIN and start selling" : "✦ Définir le PIN et commencer à vendre")}
              </button>

              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(251,197,3,0.08)", border: "1px solid rgba(251,197,3,0.2)", fontSize: 12, color: "var(--brand-light)", lineHeight: 1.5 }}>
                💡 {lang === "en"
                  ? "After setting your PIN, log into Partenaire Dozie with your registered phone number and this PIN. Your active MP products will be listed automatically."
                  : "Après avoir défini votre PIN, connectez-vous à Partenaire Dozie avec votre numéro de téléphone et ce PIN. Vos produits MP actifs seront listés automatiquement."}
              </div>
            </div>
          ) : dozieStatus?.activated ? (
            <div style={{ background: "var(--bg-card)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 16, padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 28 }}>✅</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{lang === "en" ? "Connected to Partenaire Dozie" : "Connecté à Partenaire Dozie"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    {lang === "en" ? "Your shop is live on the marketplace" : "Votre boutique est en ligne sur le marché"}
                  </div>
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{lang === "en" ? "Dozie Seller ID" : "ID Vendeur Dozie"}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, fontFamily: "monospace" }}>{dozieStatus.identity?.ptn_user_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{lang === "en" ? "Linked at" : "Lié le"}</span>
                  <span style={{ fontSize: 13 }}>{dozieStatus.identity?.linked_at ? new Date(dozieStatus.identity.linked_at).toLocaleDateString() : "—"}</span>
                </div>
              </div>
              <div style={{ marginTop: 16, background: "rgba(251,197,3,0.08)", border: "1px solid rgba(251,197,3,0.2)", borderRadius: 10, padding: 12, fontSize: 12, color: "var(--brand-light)" }}>
                💡 {lang === "en"
                  ? "Log in to Partenaire Dozie using your registered phone number and the Dozie PIN you set during activation."
                  : "Connectez-vous à Partenaire Dozie avec votre numéro de téléphone et le code PIN Dozie défini lors de l'activation."}
              </div>

              {/* MP-DOZIE-ACTIVATE-UI: Change Dozie PIN affordance.
                  Collapsed by default; expands the same 2-input PIN
                  form used in State B. Backend /dozie/activate's
                  SAME-ORG branch handles both initial-set and
                  change-PIN cases via the same endpoint. */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showChangeDoziePin ? 14 : 0 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      🔑 {lang === "en" ? "Dozie login PIN" : "PIN de connexion Dozie"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                      {lang === "en"
                        ? "Change the 4-digit PIN you use to log into Partenaire Dozie."
                        : "Modifier le PIN à 4 chiffres utilisé pour se connecter à Partenaire Dozie."}
                    </div>
                  </div>
                  <button onClick={() => {
                      const next = !showChangeDoziePin;
                      setShowChangeDoziePin(next);
                      if (!next) { setDoziePinForm({ new_pin: "", confirm_pin: "" }); setDoziePinError(""); }
                    }}
                    style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                    {showChangeDoziePin
                      ? (lang === "en" ? "Cancel" : "Annuler")
                      : (lang === "en" ? "Change PIN" : "Changer PIN")}
                  </button>
                </div>

                {/* MP-DOZIE-PIN-VISIBLE: show the seller their CURRENT
                    4-digit login PIN. Critical when the PIN was generated
                    by the MP→Dozie link (signup auto-link / activate) and
                    the seller never picked it — without this they can't
                    know what to type at the Dozie login. Owner-only
                    (backend only returns dozie_pin to the owner). Masked
                    until revealed. */}
                {!showChangeDoziePin && (
                  dozieStatus?.dozie_pin ? (
                    <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {lang === "en" ? "Your current PIN" : "Votre PIN actuel"}
                        <span style={{ marginLeft: 10, fontFamily: "monospace", fontSize: 18, fontWeight: 800, letterSpacing: revealDoziePin ? 4 : 2, color: "var(--brand-light)" }}>
                          {revealDoziePin ? dozieStatus.dozie_pin : "••••"}
                        </span>
                      </div>
                      <button onClick={() => setRevealDoziePin(v => !v)}
                        style={{ padding: "5px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
                        {revealDoziePin
                          ? (lang === "en" ? "🙈 Hide" : "🙈 Masquer")
                          : (lang === "en" ? "👁 Show" : "👁 Afficher")}
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
                      {lang === "en"
                        ? "Set a PIN below to enable your Partenaire Dozie login."
                        : "Définissez un PIN ci-dessous pour activer votre connexion Partenaire Dozie."}
                    </div>
                  )
                )}

                {showChangeDoziePin && (
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div className="form-group">
                        <label className="label">{lang === "en" ? "New PIN (4 digits)" : "Nouveau PIN (4 chiffres)"}</label>
                        <input className="input" type="password" inputMode="numeric" maxLength={4}
                          value={doziePinForm.new_pin}
                          onChange={e => setDoziePinForm(f => ({ ...f, new_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                          placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} autoFocus />
                      </div>
                      <div className="form-group">
                        <label className="label">{lang === "en" ? "Confirm PIN" : "Confirmer le PIN"}</label>
                        <input className="input" type="password" inputMode="numeric" maxLength={4}
                          value={doziePinForm.confirm_pin}
                          onChange={e => setDoziePinForm(f => ({ ...f, confirm_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                          onKeyDown={e => { if (e.key === "Enter") handleDoziePinSave(); }}
                          placeholder="••••" style={{ textAlign: "center", letterSpacing: 6 }} />
                      </div>
                    </div>
                    {doziePinError && (
                      <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12 }}>{doziePinError}</div>
                    )}
                    <button className="btn btn-primary"
                      style={{ minWidth: 180 }}
                      disabled={doziePinForm.new_pin.length !== 4 || setDoziePinMutation.isPending}
                      onClick={handleDoziePinSave}>
                      {setDoziePinMutation.isPending
                        ? "..."
                        : (lang === "en" ? "Save new PIN" : "Sauvegarder le nouveau PIN")}
                    </button>
                  </div>
                )}
              </div>

              {/* FU.5 — Pause / Reopen entire Dozie shop. */}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: shopPaused ? "rgba(239,68,68,0.08)" : "var(--bg-elevated)", border: `1px solid ${shopPaused ? "rgba(239,68,68,0.35)" : "var(--border)"}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: shopPaused ? "#fca5a5" : "var(--text-primary)", marginBottom: 4 }}>
                  {shopPaused
                    ? (lang === "en" ? "⏸ Your Dozie shop is paused" : "⏸ Votre boutique Dozie est en pause")
                    : (lang === "en" ? "Dozie Marketplace status" : "État sur le marketplace Dozie")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                  {shopPaused
                    ? (lang === "en" ? "Your listings are hidden from buyers. Your products, history, and account stay intact." : "Vos annonces sont cachées des acheteurs. Vos produits, historique et compte restent intacts.")
                    : (lang === "en" ? "Hide your shop from the Dozie marketplace without losing products or history. Reopen anytime." : "Cachez votre boutique du marketplace Dozie sans perdre vos produits ou historique. Rouvrez à tout moment.")}
                </div>
                {shopPaused ? (
                  <button onClick={() => reopenShopMutation.mutate()}
                    disabled={reopenShopMutation.isPending}
                    style={{ background: "#2E7D32", color: "#fff", border: 0, padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    {reopenShopMutation.isPending ? "..." : (lang === "en" ? "↻ Reopen my shop" : "↻ Rouvrir ma boutique")}
                  </button>
                ) : (
                  <button onClick={() => {
                      if (!window.confirm(lang === "en" ? "Pause your Dozie shop? Your listings will hide from buyers until you reopen." : "Mettre votre boutique Dozie en pause ? Vos annonces seront cachées jusqu'à réouverture.")) return;
                      pauseShopMutation.mutate();
                    }}
                    disabled={pauseShopMutation.isPending}
                    style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.35)", padding: "8px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
                    {pauseShopMutation.isPending ? "..." : (lang === "en" ? "⏸ Pause my Dozie shop" : "⏸ Mettre en pause")}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: 24 }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{lang === "en" ? "Activate Partenaire Dozie" : "Activer Partenaire Dozie"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
                {lang === "en" ? "This will create your seller profile and list your products on the wholesale marketplace." : "Cela créera votre profil vendeur et listera vos produits sur le marché de gros."}
              </div>

              {/* MP-CITY-UNIFY: city = the shop city (single source of truth),
                  shown read-only. Change it in Shop Settings; the Dozie seller
                  city follows automatically. */}
              <div className="form-group">
                <label className="label">{lang === "en" ? "City" : "Ville"}</label>
                <div className="input" style={{ display: "flex", alignItems: "center", color: dozieShopCity ? "var(--text-primary)" : "var(--text-muted)", background: "var(--bg-card)" }}>
                  {dozieShopCity || (lang === "en" ? "No city set" : "Aucune ville")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en"
                    ? "Your Dozie city is your shop city — change it in Shop Settings."
                    : "Votre ville Dozie est celle de votre boutique — modifiez-la dans Paramètres boutique."}
                </div>
              </div>

              <div className="form-group">
                <label className="label">{lang === "en" ? "Shop description (optional)" : "Description boutique (optionnel)"}</label>
                <textarea className="input" rows={3} value={dozieForm.shop_description}
                  onChange={e => setDozieForm(f => ({ ...f, shop_description: e.target.value }))}
                  placeholder={lang === "en" ? "Tell buyers what you sell..." : "Dites aux acheteurs ce que vous vendez..."} />
              </div>

              <div className="form-group">
                <label className="label">{lang === "en" ? "Choose a Dozie PIN (4 digits)" : "Choisir un code PIN Dozie (4 chiffres)"}</label>
                <input className="input" type="password" inputMode="numeric" maxLength={4}
                  value={dozieForm.dozie_pin} onChange={e => setDozieForm(f => ({ ...f, dozie_pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  placeholder="e.g. 1234" />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en" ? "You will use this PIN to log in to Partenaire Dozie" : "Vous utiliserez ce PIN pour vous connecter à Partenaire Dozie"}
                </div>
              </div>

              <button className="btn btn-primary" style={{ width: "100%", height: 46, marginTop: 8 }}
                disabled={dozieForm.dozie_pin.length !== 4 || activateDozieMutation.isPending}
                onClick={() => activateDozieMutation.mutate()}>
                {activateDozieMutation.isPending ? "..." : (lang === "en" ? "✦ Activate Partenaire Dozie" : "✦ Activer Partenaire Dozie")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══ LOCATION MODAL ═════════════════════════════════════════════════════ */}
      {(showAddLoc || editLoc) && (
        <div className="modal-overlay" onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 20 }}>
              {editLoc ? (lang === "en" ? "Edit Location" : "Modifier l'emplacement") : (lang === "en" ? "Add New Location" : "Ajouter un emplacement")}
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Name" : "Nom"} *</label>
              <input className="input" value={locForm.name} onChange={e => setLF("name", e.target.value)} placeholder="Ex: Boutique Akwa..." />
            </div>
            <div className="form-group"><label className="label">Type</label>
              <select className="input" value={locForm.type} onChange={e => setLF("type", e.target.value)}>
                <option value="warehouse">{lang === "en" ? "Warehouse (stock storage)" : "Magasin (stockage)"}</option>
                <option value="shop">{lang === "en" ? "Shop (selling point)" : "Boutique (point de vente)"}</option>
              </select>
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Address" : "Adresse"}</label>
              <input className="input" value={locForm.address} onChange={e => setLF("address", e.target.value)} placeholder="Ex: Rue Joss, Douala" />
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone" : "Téléphone"}</label>
              <input className="input" value={locForm.phone} onChange={e => setLF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddLoc(false); setEditLoc(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }} disabled={!locForm.name || addLocMutation.isPending || updateLocMutation.isPending}
                onClick={() => editLoc ? updateLocMutation.mutate() : addLocMutation.mutate()}>
                {(addLocMutation.isPending || updateLocMutation.isPending) ? "..." : (lang === "en" ? "Save" : "Enregistrer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ STAFF MODAL ════════════════════════════════════════════════════════ */}
      {(showAddStaff || editStaff) && (
        <div className="modal-overlay" onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>
              {editStaff ? (lang === "en" ? "Edit Staff Member" : "Modifier le personnel") : (lang === "en" ? "Add Staff Member" : "Ajouter un membre")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              {lang === "en" ? "Staff log in with their phone number and password" : "Le personnel se connecte avec son téléphone et mot de passe"}
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Full name" : "Nom complet"} *</label>
              <input className="input" value={staffForm.full_name} onChange={e => setSF("full_name", e.target.value)} placeholder="Jean Dupont" />
            </div>
            <div className="form-group"><label className="label">{lang === "en" ? "Phone number" : "Téléphone"} *</label>
              <input className="input" value={staffForm.phone} onChange={e => setSF("phone", e.target.value)} placeholder="6XXXXXXXX" />
            </div>
            <div className="form-group">
              <label className="label">{editStaff ? (lang === "en" ? "New password (blank = keep)" : "Nouveau mot de passe (vide = garder)") : (lang === "en" ? "Password *" : "Mot de passe *")}</label>
              <input className="input" type="password" value={staffForm.password} onChange={e => setSF("password", e.target.value)} placeholder={editStaff ? (lang === "en" ? "Leave blank to keep" : "Laisser vide pour garder") : "Min 6 caractères"} />
            </div>
            <div className="form-group"><label className="label">Role</label>
              <select className="input" value={staffForm.role} onChange={e => setSF("role", e.target.value)}>
                {ROLES.filter(r => r.value !== "owner").map(r => (
                  <option key={r.value} value={r.value}>{lang === "en" ? r.en : r.fr}</option>
                ))}
              </select>
            </div>

            {/* MP-PROPLUS-CASHIER-LOCATION: owner pins a staff member to a home
                location that follows them onto any device. Pro Plus only —
                hidden for every other plan (server also gates the write).
                MP-STAFF-LOCATION-ACCT-MGR: shown for cashier, accountant AND
                manager. OPTIONAL for all three (blank = org-wide / all
                branches). Owner is always org-wide (no field, role filtered out
                of the picker above). */}
            {["cashier", "accountant", "manager"].includes(staffForm.role) && hasFeature(effectivePlan, "staff_location_binding") && (
              <div className="form-group">
                <label className="label">
                  {lang === "en" ? "Assigned location (Pro Plus)" : "Emplacement assigné (Pro Plus)"}
                </label>
                <select className="input" value={staffForm.assigned_location_id || ""}
                  onChange={e => setSF("assigned_location_id", e.target.value)}>
                  <option value="">{lang === "en" ? "— None (org-wide / all branches) —" : "— Aucun (toute l'organisation / toutes les branches) —"}</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.type})</option>)}
                </select>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  {lang === "en"
                    ? "Optional. Pins this staff member to one branch, on any device. Leave as None for org-wide access to all branches."
                    : "Optionnel. Rattache ce membre à une seule branche, sur tout appareil. Laissez Aucun pour un accès à toutes les branches."}
                </div>
              </div>
            )}
            <div style={{ background: "var(--bg-elevated)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--text-muted)" }}>
              {staffForm.role === "cashier" && (lang === "en" ? "✓ Can: make sales, view own sales" : "✓ Peut: faire des ventes, voir ses propres ventes")}
              {staffForm.role === "manager" && (lang === "en" ? "✓ Can: all sales + inventory + add staff" : "✓ Peut: ventes + inventaire + ajouter personnel")}
              {staffForm.role === "warehouse" && (lang === "en" ? "✓ Can: receive goods, adjust stock" : "✓ Peut: réceptionner, ajuster le stock")}
              {staffForm.role === "accountant" && (lang === "en" ? "✓ Can: sales + inventory + reports. ✗ No staff, billing, or Accountant Log" : "✓ Peut: ventes + inventaire + rapports. ✗ Pas de personnel, facturation, ni Journal du comptable")}
            </div>

            {/* ── HR-LITE ENRICHMENT (Staff Maintenance) — Pro Plus + OWNER only.
                Hidden for managers and non-Pro-Plus orgs; basic fields above keep
                working for everyone. national_id + salary are owner-only (this
                whole block is owner-gated). Salary is RECORD-ONLY. ── */}
            {canHrLite && (() => {
              const photoPreview = staffForm._photoData
                || (!staffForm._photoRemove && staffForm.photo_url ? staffForm.photo_url : null);
              return (
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: "var(--brand-light)" }}>
                  ✨ {lang === "en" ? "Staff record (Pro Plus)" : "Dossier employé (Pro Plus)"}
                </div>

                {/* Photo */}
                <div className="form-group">
                  <label className="label">{lang === "en" ? "Photo" : "Photo"}</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {photoPreview ? (
                      <img src={photoPreview} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", border: "1px solid var(--border)" }} />
                    ) : (
                      <div style={{ width: 64, height: 64, borderRadius: 12, background: "var(--bg-elevated)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 22, color: "var(--text-muted)" }}>
                        {(staffForm.full_name || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                        {photoPreview ? (lang === "en" ? "Replace" : "Remplacer") : (lang === "en" ? "Upload" : "Téléverser")}
                        <input type="file" accept="image/*" style={{ display: "none" }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            try {
                              const dataUrl = await compressImageFile(file);
                              setStaffForm(f => ({ ...f, _photoData: dataUrl, _photoRemove: false }));
                            } catch { toast.error(lang === "en" ? "Could not read image" : "Image illisible"); }
                            e.target.value = "";
                          }} />
                      </label>
                      {photoPreview && (
                        <button type="button" className="btn btn-sm"
                          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
                          onClick={() => setStaffForm(f => ({ ...f, _photoData: "", _photoRemove: true }))}>
                          {lang === "en" ? "Remove" : "Retirer"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="form-group"><label className="label">{lang === "en" ? "Job / duty title" : "Poste / fonction"}</label>
                  <input className="input" value={staffForm.job_title} onChange={e => setSF("job_title", e.target.value)} placeholder={lang === "en" ? "e.g. Head cashier" : "ex. Caissier principal"} />
                </div>

                <div className="form-group"><label className="label">{lang === "en" ? "Hire date" : "Date d'embauche"} *</label>
                  <input className="input" type="date" value={staffForm.hire_date || ""} onChange={e => setSF("hire_date", e.target.value)} />
                </div>

                <div className="form-group"><label className="label">{lang === "en" ? "Employment type" : "Type d'emploi"}</label>
                  <select className="input" value={staffForm.employment_type} onChange={e => setSF("employment_type", e.target.value)}>
                    <option value="">{lang === "en" ? "— Select —" : "— Choisir —"}</option>
                    {EMP_TYPES.map(t => <option key={t.value} value={t.value}>{lang === "en" ? t.en : t.fr}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">{lang === "en" ? "Agreed salary (record only)" : "Salaire convenu (pour mémoire)"}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="input" type="number" min="0" style={{ flex: 2 }} value={staffForm.salary_amount}
                      onChange={e => setSF("salary_amount", e.target.value)} placeholder={lang === "en" ? "Amount" : "Montant"} />
                    <select className="input" style={{ flex: 1 }} value={staffForm.salary_period} onChange={e => setSF("salary_period", e.target.value)}>
                      <option value="per_month">{lang === "en" ? "/month" : "/mois"}</option>
                      <option value="per_hour">{lang === "en" ? "/hour" : "/heure"}</option>
                    </select>
                    <input className="input" style={{ flex: 1 }} value={staffForm.salary_currency}
                      onChange={e => setSF("salary_currency", e.target.value)} placeholder="XAF" />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {lang === "en" ? "Stored for your records only — no payroll calculations." : "Conservé pour vos dossiers uniquement — aucun calcul de paie."}
                  </div>
                </div>

                <div className="form-group"><label className="label">{lang === "en" ? "Emergency contact" : "Contact d'urgence"}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input className="input" style={{ flex: 1 }} value={staffForm.emergency_contact_name}
                      onChange={e => setSF("emergency_contact_name", e.target.value)} placeholder={lang === "en" ? "Name" : "Nom"} />
                    <input className="input" style={{ flex: 1 }} value={staffForm.emergency_contact_phone}
                      onChange={e => setSF("emergency_contact_phone", e.target.value)} placeholder={lang === "en" ? "Phone" : "Téléphone"} />
                  </div>
                </div>

                <div className="form-group"><label className="label">🔒 {lang === "en" ? "National ID (owner-only)" : "Pièce d'identité (propriétaire uniquement)"}</label>
                  <input className="input" value={staffForm.national_id} onChange={e => setSF("national_id", e.target.value)}
                    placeholder={lang === "en" ? "ID / CNI number" : "Numéro CNI"} />
                </div>

                <div className="form-group"><label className="label">{lang === "en" ? "Notes" : "Notes"}</label>
                  <textarea className="input" rows={3} value={staffForm.notes} onChange={e => setSF("notes", e.target.value)}
                    placeholder={lang === "en" ? "Anything else…" : "Autres informations…"} />
                </div>
              </div>
              );
            })()}

            {/* ── ACTIVITY (Phase 2) — read-only, owner + Pro Plus, edit only.
                Counts/totals + a short recent list for THIS staffer; period
                filter recomputes server-side. ── */}
            {editStaff && canHrLite && (
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--brand-light)" }}>
                  📊 {lang === "en" ? "Activity" : "Activité"}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                  {[["today", "Today", "Aujourd'hui"], ["this_week", "This week", "Cette semaine"], ["this_month", "This month", "Ce mois"], ["all", "All-time", "Tout"]].map(([v, en, fr]) => (
                    <button key={v} onClick={() => setActivityPeriod(v)}
                      className={activityPeriod === v ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                      style={{ borderRadius: 16 }}>{lang === "en" ? en : fr}</button>
                  ))}
                </div>
                {activityLoading ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{lang === "en" ? "Loading…" : "Chargement…"}</div>
                ) : (() => {
                  const a = activityData?.data; const s = a?.summary;
                  const tile = (label, count, total) => (
                    <div style={{ flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", minWidth: 88 }}>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
                      <div style={{ fontWeight: 800, fontSize: 18 }}>{count}</div>
                      {total != null && <div style={{ fontSize: 12, color: "var(--brand-light)" }}>{fmt(total)}</div>}
                    </div>
                  );
                  return (
                    <>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        {tile(lang === "en" ? "Sales" : "Ventes", s?.sales?.count || 0, s?.sales?.total || 0)}
                        {tile(lang === "en" ? "Refunds" : "Remb.", s?.refunds?.count || 0, s?.refunds?.total || 0)}
                        {tile(lang === "en" ? "Voids" : "Annul.", s?.voids?.count || 0, null)}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>{lang === "en" ? "Recent" : "Récent"}</div>
                      {(a?.recent || []).length === 0 ? (
                        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>{lang === "en" ? "No activity in this period." : "Aucune activité sur cette période."}</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {a.recent.map((r, i) => {
                            const color = r.type === "sale" ? "#34d399" : r.type === "refund" ? "#fbbf24" : "#f87171";
                            const label = r.type === "sale" ? (lang === "en" ? "Sale" : "Vente") : r.type === "refund" ? (lang === "en" ? "Refund" : "Remb.") : (lang === "en" ? "Void" : "Annul.");
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "6px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
                                <span style={{ color, fontWeight: 700, minWidth: 52 }}>{label}</span>
                                <span style={{ flex: 1, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ref || ""}</span>
                                <span style={{ fontWeight: 600 }}>{fmt(r.amount)}</span>
                                <span style={{ color: "var(--text-muted)", minWidth: 72, textAlign: "right" }}>{r.date ? new Date(r.date).toLocaleDateString() : ""}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* ── ATTENDANCE (Phase 3) — read-only records, owner + Pro Plus,
                edit only. Reuses the Activity period buttons above. ── */}
            {editStaff && canHrLite && (
              <div style={{ borderTop: "1px solid var(--border)", marginTop: 4, paddingTop: 14, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, color: "var(--brand-light)" }}>
                  🕒 {lang === "en" ? "Attendance" : "Pointage"}
                </div>
                {attendanceLoading ? (
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{lang === "en" ? "Loading…" : "Chargement…"}</div>
                ) : (() => {
                  const at = attendanceData?.data;
                  const entries = at?.entries || [];
                  const sales = at?.activity?.sales_count || 0;
                  const fmtT = (x) => x ? new Date(x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
                  const fmtD = (x) => x ? new Date(x).toLocaleDateString() : "";
                  return (
                    <>
                      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                        <div style={{ flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{lang === "en" ? "Total hours" : "Heures totales"}</div>
                          <div style={{ fontWeight: 800, fontSize: 18 }}>{at?.total_hours ?? 0} h</div>
                        </div>
                        <div style={{ flex: 1, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{lang === "en" ? "Sales (cross-check)" : "Ventes (vérif.)"}</div>
                          <div style={{ fontWeight: 800, fontSize: 18 }}>{sales}</div>
                          <div style={{ fontSize: 11, color: sales > 0 ? "#34d399" : "var(--text-muted)" }}>
                            {sales > 0 ? (lang === "en" ? "✓ active" : "✓ actif") : (lang === "en" ? "no sales" : "aucune vente")}
                          </div>
                        </div>
                      </div>
                      {entries.length === 0 ? (
                        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>{lang === "en" ? "No attendance in this period." : "Aucun pointage sur cette période."}</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {entries.map(e => (
                            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "6px 10px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}>
                              <span style={{ minWidth: 78, color: "var(--text-muted)" }}>{fmtD(e.clock_in_at)}</span>
                              <span style={{ flex: 1, textAlign: "center" }}>
                                {fmtT(e.clock_in_at)} → {e.open
                                  ? <em style={{ color: "#34d399" }}>{lang === "en" ? `open · ${e.running_hours ?? 0}h so far` : `en cours · ${e.running_hours ?? 0}h`}</em>
                                  : fmtT(e.clock_out_at)}
                              </span>
                              <span style={{ fontWeight: 700, minWidth: 48, textAlign: "right", color: e.open ? "#34d399" : undefined }}>{e.open ? `${e.running_hours ?? 0} h` : (e.hours != null ? `${e.hours} h` : "—")}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setShowAddStaff(false); setEditStaff(null); }}>{lang === "en" ? "Cancel" : "Annuler"}</button>
              <button className="btn btn-primary" style={{ flex: 2 }}
                disabled={!staffForm.full_name || !staffForm.phone || (!editStaff && !staffForm.password) || (canHrLite && !staffForm.hire_date) || addStaffMutation.isPending || updateStaffMutation.isPending}
                onClick={() => editStaff ? updateStaffMutation.mutate() : addStaffMutation.mutate()}>
                {(addStaffMutation.isPending || updateStaffMutation.isPending) ? "..." : (editStaff ? (lang === "en" ? "Save changes" : "Enregistrer") : (lang === "en" ? "Add staff member" : "Ajouter"))}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sprint A: receipt branding paywall */}
      {brandingPaywall && (
        <PaywallModal feature="receipt_branding"
          currentPlan={effectivePlan}
          mpId={myPlan?.user_id_number}
          onClose={() => setBrandingPaywall(false)} />
      )}

      {/* MP-DEBUG-REVEAL: tappable version footer — 5 taps toggles debug mode. */}
      <div onClick={handleVersionTap}
        style={{ textAlign: "center", padding: "20px 0 8px", color: "var(--text-muted)", fontSize: 11, userSelect: "none" }}>
        Mon Partenaire Dozie · v1.0.0
      </div>
    </div>
  );
}
