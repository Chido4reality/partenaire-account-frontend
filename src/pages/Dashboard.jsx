import { useState } from 'react';
import { useOfflineCachedQuery } from '../utils/offlineQuery';
import { useLiteMode } from '../hooks/useLiteMode';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLangStore } from '../store';
import api, { formatDate, getGreeting } from '../utils/api';
import { useCurrency } from '../utils/useCurrency';
import { ActiveShiftIndicator } from '../components/common/ShiftWidgets';
import DrawerDashboardCard from '../components/dashboard/DrawerDashboardCard';

const StatCard = ({ label, value, sub, color = 'var(--brand-light)', icon, onClick }) => (
  <div className="stat-card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value" style={{ color, fontSize: 22 }}>{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <div style={{ fontSize: 20, opacity: 0.6 }}>{icon}</div>
    </div>
  </div>
);

const QuickBtn = ({ icon, label, to, color }) => {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(to)} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 10px', cursor: 'pointer',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      color: 'var(--text-primary)', fontSize: 12, fontWeight: 500,
      transition: 'all 0.15s', flex: 1
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `${color}15`; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)'; }}>
      <span style={{ fontSize: 22 }}>{icon}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </button>
  );
};

export default function Dashboard() {
  const { user } = useAuthStore();
  const { t, lang } = useLangStore();
  const navigate = useNavigate();
  const fmt = useCurrency();
  // MP-LITE-MODE-PHASE-1: skip Dozie nudge query, hide Net Profit card,
  // hide Sell-on-Dozie banner in Lite. Owners flip via Settings → Mode.
  const lite = useLiteMode();

  // MP-DASHBOARD-REPORT-CONSISTENCY: explicit location filter, default
  // "" = All locations. Decoupled from the global selectedLocation store
  // so Dashboard's "today's sales" matches Reports (which also defaults
  // to All) — same backend filter, same number. Selecting a shop here
  // scopes only this page's today figures, not the POS/Stock context.
  const [locFilter, setLocFilter] = useState("");
  const { data: locsResp } = useOfflineCachedQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/locations").then(r => r.data),
    staleTime: 300000
  });
  const dashLocations = locsResp?.data || [];

  const role = user?.role || 'cashier';
  const isOwner = role === 'owner';
  const isManager = role === 'manager';
  const isCashier = role === 'cashier';
  const isWarehouse = role === 'warehouse';

  const today = new Date().toLocaleDateString(lang === 'fr' ? 'fr-CM' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const roleIcon = { owner: '👑', manager: '🔑', cashier: '🛒', warehouse: '📦' }[role] || '👤';
  const firstName = user?.full_name?.split(' ')[0] || '';

  const { data: summary, isLoading } = useOfflineCachedQuery({
    queryKey: ['daily-summary', locFilter],
    queryFn: async () => {
      const params = locFilter ? `?location_id=${locFilter}` : '';
      const res = await api.get(`/sales/today/summary${params}`);
      return res.data;
    },
    refetchInterval: 60000
  });

  const { data: alerts } = useOfflineCachedQuery({
    queryKey: ['stock-alerts'],
    queryFn: async () => api.get('/stock?low_only=true').then(r => r.data),
    refetchInterval: 300000,
    enabled: !isCashier
  });

  const { data: recentSales } = useOfflineCachedQuery({
    queryKey: ['recent-sales'],
    queryFn: async () => api.get('/sales?limit=8').then(r => r.data),
    refetchInterval: 30000
  });

  const { data: credits } = useOfflineCachedQuery({
    queryKey: ['overdue-credits'],
    queryFn: async () => api.get('/reports/debts').then(r => r.data),
    enabled: isOwner || isManager
  });

  // MP-DOZIE-INVENTORY-PUBLISH-UI: zero-listings nudge for owners.
  // Surfaces a banner when the org has 0 Dozie publications, linking
  // straight to /inventory. Owner/manager only — cashier doesn't
  // publish.
  const { data: dozieListings } = useOfflineCachedQuery({
    queryKey: ['dozie-listings'],
    queryFn: () => api.get('/dozie-listings').then(r => r.data?.data || []),
    // MP-LITE-MODE-PHASE-1: Marketplace banner hidden in Lite, no need
    // to fetch listing state.
    enabled: !lite && (isOwner || isManager),
    staleTime: 60000,
    fallback: [],
  });
  const hasZeroDozieListings = !lite && (isOwner || isManager) && Array.isArray(dozieListings) && dozieListings.length === 0;

  const s = summary?.data || {};
  const overdueCount = credits?.data?.filter(c => c.earliest_due && new Date(c.earliest_due) < new Date())?.length || 0;
  const lowStockCount = alerts?.data?.length || 0;

  const statusColor = (status) => {
    if (status === 'paid') return '#10b981';
    if (status === 'partial') return '#f59e0b';
    return '#ef4444';
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {/* MP-CASH-SHIFTS-UI: live indicator. Uses the global
          selectedLocation; hosts the open/close modals internally. */}
      <div style={{ marginBottom: 16 }}>
        <ActiveShiftIndicator />
      </div>

      {/* MP-DOZIE-INVENTORY-PUBLISH-UI: zero-listings nudge. Owners
          who haven't published anything yet land here with no signal
          that the connection exists at all — this banner closes that
          loop. Click → /inventory where the 🛒 buttons on each row
          start the publish flow. */}
      {hasZeroDozieListings && (
        <div style={{
          marginBottom: 16, padding: "12px 16px",
          background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.35)",
          borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 20 }}>🛒</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>
                {lang === 'en'
                  ? "Your shop is connected to Partenaire Dozie, but you haven't published any products yet."
                  : "Votre boutique est connectée à Partenaire Dozie, mais aucun produit n'est encore publié."}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {lang === 'en'
                  ? "Open Inventory and tap the 🛒 button on any product to publish it to the marketplace."
                  : "Ouvrez Inventaire et appuyez sur 🛒 sur un produit pour le publier sur le marché."}
              </div>
            </div>
          </div>
          <button onClick={() => navigate('/inventory')}
            style={{ padding: "8px 14px", border: "none", borderRadius: 8, background: "#6366f1", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
            {lang === 'en' ? "Publish products →" : "Publier des produits →"}
          </button>
        </div>
      )}

      {/* MP-DRAWER-DASHBOARD-CARD: detailed breakdown with click-through
          drilldowns into cash sales / refunds / expenses. Shares the
          ["current-shift", locId] cache with the indicator so they
          stay in sync without a duplicate request. */}
      <div style={{ marginBottom: 24 }}>
        <DrawerDashboardCard />
      </div>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'capitalize' }}>
            {getGreeting(lang)}, {firstName} {roleIcon}
          </div>
          <h1 className="page-title">{t('nav.dashboard')}</h1>
          <div className="page-sub" style={{ textTransform: 'capitalize' }}>{today}</div>
          {/* MP-DASHBOARD-REPORT-CONSISTENCY: location filter (default
              All) — same options/semantics as Reports so the numbers
              agree. */}
          <div style={{ marginTop: 8 }}>
            <select value={locFilter} onChange={e => setLocFilter(e.target.value)}
              style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-primary)" }}>
              <option value="">{lang === 'en' ? 'All locations' : 'Tous les sites'}</option>
              {dashLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          {/* Role badge */}
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 600, background: isOwner ? "rgba(251,191,36,0.15)" : isManager ? "rgba(251,197,3,0.15)" : isWarehouse ? "rgba(52,211,153,0.15)" : "rgba(148,163,184,0.15)", color: isOwner ? "#fbbf24" : isManager ? "var(--brand-light)" : isWarehouse ? "#34d399" : "#94a3b8" }}>
              {roleIcon} {user?.full_name} · {role.charAt(0).toUpperCase() + role.slice(1)}
            </span>
          </div>
        </div>
        {!isWarehouse && (
          <button className="btn btn-primary" onClick={() => navigate('/pos')} style={{ gap: 8 }}>
            🛒 {t('nav.sales')}
          </button>
        )}
      </div>

      {/* Alerts — only for owner/manager */}
      {(isOwner || isManager) && (lowStockCount > 0 || overdueCount > 0) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {lowStockCount > 0 && (
            <div onClick={() => navigate('/inventory')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#fbbf24' }}>
              ⚠️ {lowStockCount} {t('dashboard.lowStockAlert')}
            </div>
          )}
          {overdueCount > 0 && (
            <div onClick={() => navigate('/credits')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#f87171' }}>
              🔴 {overdueCount} {t('dashboard.overdueCredits')}
            </div>
          )}
        </div>
      )}

      {/* ── WAREHOUSE VIEW ── */}
      {isWarehouse && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard icon="📦" label={lang === 'en' ? "Low stock items" : "Articles stock bas"}
              value={lowStockCount || 0} color="#fbbf24"
              sub={lang === 'en' ? "Need restocking" : "À réapprovisionner"}
              onClick={() => navigate('/inventory')} />
            <StatCard icon="🔄" label={lang === 'en' ? "Transfers today" : "Transferts aujourd'hui"}
              value="→" color="var(--brand-light)"
              sub={lang === 'en' ? "View transfers" : "Voir transferts"}
              onClick={() => navigate('/transfers')} />
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>{lang === 'en' ? "Warehouse Dashboard" : "Tableau de bord entrepôt"}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>{lang === 'en' ? "Manage stock, receive goods and process transfers." : "Gérez le stock, réceptionnez les marchandises et traitez les transferts."}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => navigate('/inventory')}>📦 Inventory</button>
              <button className="btn btn-secondary" onClick={() => navigate('/transfers')}>🔄 Transfers</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CASHIER VIEW ── */}
      {isCashier && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard icon="🛒" label={lang === 'en' ? "My sales today" : "Mes ventes aujourd'hui"}
              value={isLoading ? '...' : fmt(s.gross_sales || 0)}
              sub={`${s.sale_count || 0} ${t('dashboard.transactions')}`}
              color="var(--brand-light)" onClick={() => navigate('/reports')} />
            <StatCard icon="💵" label={lang === 'en' ? "Cash collected" : "Espèces encaissées"}
              value={isLoading ? '...' : fmt(s.cash_collected || 0)}
              color="#10b981" />
            <StatCard icon="💳" label={lang === 'en' ? "Credit sales" : "Ventes crédit"}
              value={isLoading ? '...' : fmt(s.credit_sales || 0)}
              color="#f59e0b" onClick={() => navigate('/credits')} />
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            <QuickBtn icon="🛒" label={lang === 'en' ? "New Sale" : "Nouvelle vente"} to="/pos" color="var(--brand)" />
            <QuickBtn icon="💰" label={lang === 'en' ? "Cash Register" : "Caisse"} to="/shifts" color="#10b981" />
            <QuickBtn icon="👥" label={lang === 'en' ? "Customers" : "Clients"} to="/customers" color="#7c3aed" />
          </div>
        </div>
      )}

      {/* ── OWNER / MANAGER VIEW ── */}
      {(isOwner || isManager) && (
        <div>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard icon="📊" label={t('dashboard.todaySales')}
              value={isLoading ? '...' : fmt(s.gross_sales || 0)}
              sub={`${s.sale_count || 0} ${t('dashboard.transactions')}`}
              color="var(--brand-light)" onClick={() => navigate('/reports')} />
            <StatCard icon="💵" label={t('dashboard.cashCollected')}
              value={isLoading ? '...' : fmt(s.cash_collected || 0)}
              color="#10b981" />
            {/* MP-LITE-MODE-PHASE-1: Net Profit hidden in Lite — Pro analytic. */}
            {isOwner && !lite && (
              <StatCard icon="📈" label={t('dashboard.netProfit')}
                value={isLoading ? '...' : fmt(s.net_profit || 0)}
                sub={s.profit_margin_pct ? `${s.profit_margin_pct}% margin` : ''}
                color={s.net_profit >= 0 ? '#10b981' : '#ef4444'} />
            )}
            <StatCard icon="💳" label={t('dashboard.creditSales')}
              value={isLoading ? '...' : fmt(s.credit_sales || 0)}
              color="#f59e0b" onClick={() => navigate('/credits')} />
            <StatCard icon="💸" label={t('dashboard.totalExpenses')}
              value={isLoading ? '...' : fmt(s.total_expenditure || 0)}
              color="#ef4444" onClick={() => navigate('/expenditures')} />
            {isOwner && (
              <StatCard icon="🏦" label={t('dashboard.netCash')}
                value={isLoading ? '...' : fmt(s.net_cash || 0)}
                color={s.net_cash >= 0 ? '#10b981' : '#ef4444'} />
            )}
          </div>

          {/* MP-MOBILE-UI-PHASE-1-5: stack columns on mobile so the
              Recent Sales card isn't squeezed into a ~60px slot beside
              the 280px Quick Actions sidebar. md:grid-cols-[1fr_280px]
              preserves the desktop sidebar layout. */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-5 items-start">
            {/* Recent sales — overflow:auto so the wide table can
                h-scroll on mobile when stacked full-width still isn't
                enough for all 5 columns. minWidth on the table mirrors
                the InventoryPage Stock Levels fix pattern (aea7e27). */}
            <div className="card" style={{ padding: 0, overflow: 'auto' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{t('dashboard.recentSales')}</span>
                <button onClick={() => navigate('/reports')} className="btn btn-secondary btn-sm">
                  {t('common.all')} →
                </button>
              </div>
              {recentSales?.data?.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📊</div>
                  <div className="empty-state-text">{t('common.noData')}</div>
                </div>
              ) : (
                <table className="table" style={{ minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th>{lang === 'en' ? 'Invoice' : 'Facture'}</th>
                      <th>{t('common.date')}</th>
                      <th>{t('nav.customers')}</th>
                      <th style={{ textAlign: 'right' }}>{t('common.total')}</th>
                      <th>{t('common.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales?.data?.map(sale => (
                      <tr key={sale.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{sale.sale_number}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{formatDate(sale.sale_date, lang)}</td>
                        <td>{sale.pa_customers?.name || <span style={{ color: 'var(--text-muted)' }}>{t('pos.noCustomer')}</span>}</td>
                        {/* MP-REPORTS-DEBT-DOUBLECOUNT: show the sale's GOODS value
                            (product-line net), with any debt collected on the same
                            invoice noted separately — not a combined sale+debt total. */}
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>
                          {fmt(sale.product_net != null ? sale.product_net : sale.total_amount)}
                          {Number(sale.debt_payment_amount) > 0 && (
                            <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 600 }}>
                              +{fmt(sale.debt_payment_amount)} {lang === 'en' ? 'debt' : 'dette'}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="badge" style={{ background: `${statusColor(sale.payment_status)}20`, color: statusColor(sale.payment_status) }}>
                            {t(`common.${sale.payment_status}`)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Quick actions */}
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, marginBottom: 12, color: 'var(--text-secondary)' }}>
                {t('dashboard.quickActions')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <QuickBtn icon="🛒" label={t('pos.title')}          to="/pos"          color="var(--brand)" />
                <QuickBtn icon="📦" label={t('stock.arrivals')}     to="/inventory"    color="#0891b2" />
                <QuickBtn icon="🔄" label={t('transfers.new')}      to="/transfers"    color="#7c3aed" />
                <QuickBtn icon="💸" label={t('expenditures.new')}   to="/expenditures" color="#dc2626" />
                <QuickBtn icon="👥" label={t('nav.customers')}      to="/customers"    color="#059669" />
                <QuickBtn icon="💳" label={t('nav.credits')}        to="/credits"      color="#d97706" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
