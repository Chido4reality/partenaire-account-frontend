// BAR LAYOUT (Peter 2026-11-18) — the /bar look from docs/bar-mockup.png.png: dark navy page, solid
// colour product boxes, amber accent (the app's own --brand), a cream "Counter sale" card.
// Injected by BarPage only, and every rule is scoped under .bar-screen — New Sale and every other
// page keep their look. Inside .bar-cart the POS cart's own colour tokens are re-pointed to cream /
// navy; its markup and logic are untouched.
export const BAR_CSS = `
.bar-screen{--bar-bg:#0b1730;--bar-bg2:#0f1f3f;--bar-line:rgba(148,163,184,.28);--bar-amber:var(--brand,#FBC503);
  --bg-base:transparent;min-height:100%;height:100%;display:flex;flex-direction:column;
  background:radial-gradient(120% 80% at 50% 0%,#132a52 0%,var(--bar-bg) 60%);color:#f8fafc}
.bar-screen *{box-sizing:border-box}
.bar-top{display:flex;align-items:center;gap:14px;padding:12px 16px;flex-wrap:wrap}
.bar-brand{display:flex;align-items:center;gap:10px;font-family:var(--font-display);font-weight:800;font-size:22px;white-space:nowrap}
.bar-brand small{font-weight:500;opacity:.65;font-size:22px}
.bar-vsep{width:1px;height:30px;background:var(--bar-line)}
.bar-select{background:var(--bar-bg2);color:#f8fafc;border:1px solid var(--bar-line);border-radius:10px;padding:8px 12px;font-weight:600;font-size:15px}
.bar-top-right{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
.bar-outline-btn{display:inline-flex;align-items:center;gap:8px;background:transparent;color:#f8fafc;border:1.5px solid var(--bar-line);
  border-radius:12px;padding:9px 16px;font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
.bar-outline-btn.is-accent,.bar-outline-btn[aria-pressed="true"]{border-color:var(--bar-amber)}
.bar-icon-btn{background:transparent;border:1.5px solid var(--bar-line);color:#f8fafc;border-radius:10px;padding:6px 10px;cursor:pointer;font-size:18px;line-height:1}
.bar-row{display:flex;align-items:center;gap:14px;margin:0 16px;padding:10px 12px;background:rgba(15,31,63,.75);
  border:1px solid var(--bar-line);border-radius:14px;min-width:0}
.bar-home{flex:none;display:inline-flex;align-items:center;gap:8px;padding:9px 18px;border-radius:10px;font-weight:800;font-size:16px;cursor:pointer;
  background:transparent;color:#f8fafc;border:1.5px solid var(--bar-line)}
.bar-home.is-on{background:var(--bar-amber);color:var(--on-brand,#152B52);border-color:var(--bar-amber)}
.bar-row-sep{flex:none;width:1px;height:30px;background:var(--bar-line)}
.bar-row-scroll{flex:1;min-width:0;display:flex;align-items:center;gap:12px;overflow-x:auto;white-space:nowrap;scrollbar-width:thin;padding-bottom:2px}
.bar-row-group{display:inline-flex;align-items:center;gap:10px}
.bar-zone{font-weight:700;font-size:15px;opacity:.95;padding:0 4px}
.bar-pill{flex:none;padding:8px 16px;border-radius:10px;font-size:15px;cursor:pointer;background:transparent;color:#f8fafc;border:1.5px solid rgba(248,250,252,.75)}
.bar-pill.has-bill{border-color:var(--bar-amber);color:var(--bar-amber)}
.bar-pill.is-on{background:var(--bar-amber);border-color:var(--bar-amber);color:var(--on-brand,#152B52);box-shadow:0 0 0 3px rgba(251,197,3,.35)}
.bar-msg{margin:8px 16px 0;padding:8px 12px;border-radius:10px;font-size:14px;border:1px solid}
.bar-body{flex:1;min-height:0;display:flex;gap:18px;padding:14px 16px 16px}
.bar-left{flex:1;min-width:0;overflow-y:auto}
.bar-quick-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:4px 0 16px}
.bar-quick-title{margin:0;font-family:var(--font-display);font-weight:800;font-size:40px;line-height:1.05;color:#fff}
.bar-quick-sub{font-size:18px;opacity:.7;margin-top:2px}
.bar-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.bar-box{--box:#1d4ed8;display:flex;align-items:center;gap:14px;min-height:150px;padding:16px;border-radius:16px;cursor:pointer;text-align:left;color:#fff;
  background:var(--box);border:1.5px solid rgba(255,255,255,.35);
  background:linear-gradient(160deg,color-mix(in srgb,var(--box) 82%,#fff 18%) 0%,var(--box) 55%,color-mix(in srgb,var(--box) 80%,#000 20%) 100%);
  border:1.5px solid color-mix(in srgb,var(--box) 60%,#fff 40%);box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .08s}
.bar-box:active{transform:scale(.97)}
.bar-box-pic{flex:none;width:72px;height:96px;object-fit:contain;border-radius:10px}
.bar-box-icon{color:rgba(255,255,255,.92);padding:10px}
.bar-box-emoji{display:flex;align-items:center;justify-content:center;font-size:48px}
.bar-box-text{display:flex;flex-direction:column;gap:10px;min-width:0;padding-left:14px;border-left:1.5px solid rgba(255,255,255,.35)}
.bar-box-name{font-family:var(--font-display);font-weight:800;font-size:24px;line-height:1.1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.bar-box-price{align-self:flex-start;font-weight:800;font-size:17px;padding:5px 12px;border-radius:10px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);white-space:nowrap}
.bar-empty{grid-column:1/-1;opacity:.7;padding:20px 0}
.bar-card{background:#FBF3E4;color:#13203a;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column;min-height:0}
.bar-card-head{display:flex;align-items:center;gap:12px;padding:18px 20px 10px;font-family:var(--font-display);font-weight:800;font-size:26px}
.bar-card-body{padding:0 20px 16px;overflow-y:auto;display:grid;gap:10px}
.bar-card button.bar-cbtn{background:transparent;color:#13203a;border:1.5px solid #c9bfa9;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
.bar-card button.bar-cmain{background:var(--bar-amber);color:var(--on-brand,#152B52);border:none;border-radius:12px;padding:12px 16px;font-weight:800;font-size:16px;cursor:pointer}
.bar-card button:disabled{opacity:.5;cursor:not-allowed}
.bar-card select,.bar-card input{background:#fff;color:#13203a;border:1px solid #d8ccb3;border-radius:10px;padding:8px}
.bar-line{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #e8dcc4;font-size:16px}
.bar-total{display:flex;justify-content:space-between;align-items:baseline;background:#F4E7CF;border-radius:14px;padding:14px 16px;font-weight:800}
.bar-total b{font-size:28px}
/* the POS cart, re-pointed to the cream card (logic and markup unchanged) */
.bar-screen .bar-cart{--bg-surface:#FBF3E4;--bg-elevated:#F4E7CF;--bg-card:#fff8ec;--bg-base:#FBF3E4;--text-primary:#13203a;--text-secondary:#3b4660;
  --text-muted:#6b7280;--border:#e3d5ba;--border-hover:#cdbb98;--brand-light:#9a6b00;color:#13203a;
  border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35);align-self:stretch}
.bar-screen .bar-cart .bar-pay-row>*{flex:1}
/* Home: the embedded POS fills one grid cell (its root is height:100%) */
.bar-home-body{flex:1;min-height:0;display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,1fr);padding-top:6px}
.bar-screen .bar-cart{margin:0 16px 16px 0}
@media (max-width:1100px){.bar-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bar-quick-title{font-size:32px}.bar-box-name{font-size:20px}}
@media (max-width:767px){
  .bar-menu-btn{display:none}
  .bar-brand,.bar-brand small{font-size:18px}.bar-top{gap:8px;padding:10px 12px}.bar-row{margin:0 12px;gap:10px}
  .bar-body{flex-direction:column;padding:12px;overflow-y:auto}.bar-left{overflow:visible}
  .bar-grid{gap:10px}.bar-box{min-height:112px;padding:10px;gap:8px}.bar-box-pic{width:44px;height:64px}
  .bar-box-text{padding-left:8px;gap:6px}.bar-box-name{font-size:16px}.bar-box-price{font-size:13px;padding:3px 8px}
  .bar-quick-title{font-size:26px}.bar-quick-sub{font-size:14px}
}
`;
