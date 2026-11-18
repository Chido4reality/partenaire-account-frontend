// BAR LAYOUT (Peter 2026-11-18): the next-round draft of each table / counter tab, kept per
// (person × branch × tab) — utils/barLayout.js draftKey. Switching view never sends, merges or moves
// a draft. Each draft carries its own send key (a changed draft is a different round). Drafts older
// than 12 h are dropped. Home's counter sale is NOT here: it is the POS cart (useDraftCartStore).
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { safeStorage } from "../utils/safeStorage";

const TTL_MS = 12 * 3600 * 1000;
const MAX = 40;

export const useBarDraftStore = create(persist(
  (set, get) => ({
    drafts: {},
    getDraft: (key) => {
      const d = key ? get().drafts[key] : null;
      return d && Date.now() - (d.updatedAt || 0) <= TTL_MS ? d : null;
    },
    setDraft: (key, items, roundKey) => {
      if (!key) return;
      const now = Date.now();
      set((s) => {
        const kept = {};
        for (const [k, d] of Object.entries(s.drafts || {})) if (k !== key && now - (d.updatedAt || 0) <= TTL_MS) kept[k] = d;
        if (items && items.length) kept[key] = { items, roundKey, updatedAt: now };
        const entries = Object.entries(kept).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX);
        return { drafts: Object.fromEntries(entries) };
      });
    },
    clearDraft: (key) => set((s) => { const d = { ...(s.drafts || {}) }; delete d[key]; return { drafts: d }; }),
  }),
  { name: "bar-round-drafts", storage: createJSONStorage(() => safeStorage) },
));
