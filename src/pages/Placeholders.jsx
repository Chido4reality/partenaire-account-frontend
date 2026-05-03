import { useLangStore } from "../store";

const Shell = ({ icon, titleKey, children }) => {
  const { t } = useLangStore();
  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div className="page-header">
        <h1 className="page-title">{icon} {t(titleKey)}</h1>
      </div>
      {children}
    </div>
  );
};

const Soon = ({ name }) => (
  <div style={{ border: "2px dashed var(--border)", borderRadius: 16, padding: 64, textAlign: "center", color: "var(--text-muted)" }}>
    <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.4 }}>âŠŸ</div>
    <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>{name} â€” Coming next</div>
    <div style={{ fontSize: 13 }}>Database and API fully ready. UI module building next.</div>
  </div>
);

export const InventoryPage   = () => <Shell icon="âŠŸ" titleKey="nav.inventory"><Soon name="Inventory" /></Shell>;
export const CustomersPage   = () => <Shell icon="â—‰" titleKey="nav.customers"><Soon name="Customers" /></Shell>;
export const CreditsPage     = () => <Shell icon="â—Ž" titleKey="nav.credits"><Soon name="Credits" /></Shell>;
export const TransfersPage   = () => <Shell icon="â‡„" titleKey="nav.transfers"><Soon name="Transfers" /></Shell>;
export const ExpenditurePage = () => <Shell icon="âŠ–" titleKey="nav.expenditures"><Soon name="Expenses" /></Shell>;
export const ReportsPage     = () => <Shell icon="â–¦" titleKey="nav.reports"><Soon name="Reports" /></Shell>;
export const SettingsPage    = () => <Shell icon="âš™" titleKey="nav.settings"><Soon name="Settings" /></Shell>;
