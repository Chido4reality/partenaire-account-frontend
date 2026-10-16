// MY ACCOUNT (Peter, 2026-10-16) — every role's own account page. Today: change your own
// password. Settings is owner/manager only, so staff need a page of their own; owner and
// manager also have the same card in Settings → Account.
import { useLangStore, useAuthStore } from "../store";
import ChangePasswordCard from "../components/common/ChangePasswordCard";

export default function MyAccountPage() {
  const { lang } = useLangStore();
  const user = useAuthStore((s) => s.user);
  const en = lang === "en";
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="page-title">👤 {en ? "My account" : "Mon compte"}</h1>
      {user && (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 16px" }}>
          {user.full_name}{user.phone ? ` · ${user.phone}` : ""}
        </div>
      )}
      <ChangePasswordCard en={en} />
    </div>
  );
}
