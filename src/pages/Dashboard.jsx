import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore, useLangStore, useSettingsStore } from '../store';
import api, { formatCFA, formatDate, getGreeting } from '../utils/api';

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
  const { selectedLocation } = useSettingsStore();
  const navigate = useNavigate();

  const today = new Date().toLocaleDateString(lang === 'fr' ? 'fr-CM' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['daily-summary', selectedLocation?.id],
    queryFn: async () => {
      const params = selectedLocation ? `?location_id=${selectedLocation.id}` : '';
      const res = await api.get(`/sales/today/summary${params}`);
      return res.data;
    },
    refetchInterval: 60000
  });

  const { data: alerts } = useQuery({
    queryKey: ['stock-alerts'],
    queryFn: async () => api.get('/stock?low_only=true').then(r => r.data),
    refetchInterval: 300000
  });

  const { data: recentSales } = useQuery({
    queryKey: ['recent-sales'],
    queryFn: async () => api.get('/sales?limit=8').then(r => r.data),
    refetchInterval: 30000
  });

  const { data: credits } = useQuery({
    queryKey: ['overdue-credits'],
    queryFn: async () => api.get('/reports/debts').then(r => r.data),
  });

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
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 28 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4, textTransform: 'capitalize' }}>
            {getGreeting(lang)}, {user?.full_name?.split(' ')[0]} 👋
          </div>
          <h1 className="page-title">{t('nav.dashboard')}</h1>
          <div className="page-sub" style={{ textTransform: 'capitalize' }}>{today}</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/pos')} style={{ gap: 8 }}>
          ⊕ {t('nav.sales')}
        </button>
      </div>

      {/* Alerts */}
      {(lowStockCount > 0 || overdueCount > 0) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {lowStockCount > 0 && (
            <div onClick={() => navigate('/inventory')} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#fbbf24'
            }}>
              ⚠ {lowStockCount} {t('dashboard.lowStockAlert')}
            </div>
          )}
          {overdueCount > 0 && (
            <div onClick={() => navigate('/credits')} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 10, cursor: 'pointer', fontSize: 13, color: '#f87171'
            }}>
              ◎ {overdueCount} {t('dashboard.overdueCredits')}
            </div>
          )}
        </div>
      )}

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        <StatCard icon="◈" label={t('dashboard.todaySales')}
          value={isLoading ? '...' : formatCFA(s.gross_sales || 0)}
          sub={`${s.sale_count || 0} ${t('dashboard.transactions')}`}
          color="var(--brand-light)" onClick={() => navigate('/reports')} />
        <StatCard icon="◉" label={t('dashboard.cashCollected')}
          value={isLoading ? '...' : formatCFA(s.cash_collected || 0)}
          color="#10b981" />
        <StatCard icon="▦" label={t('dashboard.netProfit')}
          value={isLoading ? '...' : formatCFA(s.net_profit || 0)}
          sub={s.profit_margin_pct ? `${s.profit_margin_pct}% ${t('dashboard.profitMargin')}` : ''}
          color={s.net_profit >= 0 ? '#10b981' : '#ef4444'} />
        <StatCard icon="⊟" label={t('dashboard.creditSales')}
          value={isLoading ? '...' : formatCFA(s.credit_sales || 0)}
          color="#f59e0b" onClick={() => navigate('/credits')} />
        <StatCard icon="⊖" label={t('dashboard.totalExpenses')}
          value={isLoading ? '...' : formatCFA(s.total_expenditure || 0)}
          color="#ef4444" onClick={() => navigate('/expenditures')} />
        <StatCard icon="◎" label={t('dashboard.netCash')}
          value={isLoading ? '...' : formatCFA(s.net_cash || 0)}
          color={s.net_cash >= 0 ? '#10b981' : '#ef4444'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
        {/* Recent sales */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{t('dashboard.recentSales')}</span>
            <button onClick={() => navigate('/reports')} className="btn btn-secondary btn-sm">
              {t('common.all')} →
            </button>
          </div>

          {recentSales?.data?.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <div className="empty-state-text">{t('common.noData')}</div>
            </div>
          ) : (
            <table className="table">
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
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatCFA(sale.total_amount)}</td>
                    <td>
                      <span className="badge" style={{
                        background: `${statusColor(sale.payment_status)}20`,
                        color: statusColor(sale.payment_status)
                      }}>
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
            <QuickBtn icon="⊕" label={t('pos.title')}           to="/pos"          color="var(--brand)" />
            <QuickBtn icon="⊟" label={t('stock.arrivals')}      to="/inventory"    color="#0891b2" />
            <QuickBtn icon="⇄" label={t('transfers.new')}       to="/transfers"    color="#7c3aed" />
            <QuickBtn icon="⊖" label={t('expenditures.new')}    to="/expenditures" color="#dc2626" />
            <QuickBtn icon="◉" label={t('nav.customers')}       to="/customers"    color="#059669" />
            <QuickBtn icon="◎" label={t('nav.credits')}         to="/credits"      color="#d97706" />
          </div>
        </div>
      </div>
    </div>
  );
}
