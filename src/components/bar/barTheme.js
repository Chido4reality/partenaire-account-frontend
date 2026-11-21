// BAR LAYOUT (Peter 2026-11-18) — the /bar look from docs/bar-mockup.png.png: dark navy page, solid
// colour product boxes, amber accent (the app's own --brand), a cream "Counter sale" card.
// Injected by BarPage only, and every rule is scoped under .bar-screen (or .bar-shell, the class Layout
// puts on its desktop shell on /bar only) — New Sale and every other page keep their look. Inside
// .bar-cart the POS cart's own colour tokens are re-pointed to cream / navy; its logic is untouched.
//
// BAR FIT (Peter 2026-11-18): the whole screen fits the VISIBLE window on every device with no page
// scroll: header + tables row are compact (flex:none), the body takes the rest (flex:1, min-height:0);
// only the product grid scrolls in its own area; the cart / table card runs full height with its
// middle scrolling and Total + actions always visible. Columns: 2 below 900px, 3 from 900px, 4 from
// 1366px; box, picture and fonts scale with clamp(). Below 900px the Home cart is the existing bottom
// sheet and the table card sits under the grid with a capped height. Proof: scripts/bar-fit/shots.mjs.
export const BAR_CSS = `
@supports (height:100dvh){.bar-shell{height:100dvh !important}}
.bar-screen{--bar-bg:#0b1730;--bar-bg2:#0f1f3f;--bar-line:rgba(148,163,184,.28);--bar-amber:var(--brand,#FBC503);
  --bg-base:transparent;height:100%;min-height:0;overflow:hidden;display:flex;flex-direction:column;
  background:radial-gradient(120% 80% at 50% 0%,#132a52 0%,var(--bar-bg) 60%);color:#f8fafc}
.bar-screen *{box-sizing:border-box}
.bar-top{flex:none;display:flex;align-items:center;gap:clamp(8px,1.2vw,14px);padding:clamp(6px,1.1vh,12px) 16px;flex-wrap:nowrap;min-width:0}
.bar-brand{display:flex;align-items:center;gap:8px;font-family:var(--font-display);font-weight:800;font-size:clamp(16px,1.6vw,22px);white-space:nowrap}
.bar-brand small{font-weight:500;opacity:.65;font-size:inherit}
.bar-vsep{flex:none;width:1px;height:28px;background:var(--bar-line)}
.bar-select{min-width:0;max-width:40vw;background:var(--bar-bg2);color:#f8fafc;border:1px solid var(--bar-line);border-radius:10px;padding:clamp(5px,.9vh,8px) 10px;font-weight:600;font-size:15px}
.bar-top-right{margin-left:auto;display:flex;gap:8px;flex:none}
.bar-outline-btn{display:inline-flex;align-items:center;gap:8px;background:transparent;color:#f8fafc;border:1.5px solid var(--bar-line);
  border-radius:12px;padding:clamp(5px,.9vh,9px) 14px;font-weight:700;font-size:clamp(13px,1.1vw,15px);cursor:pointer;white-space:nowrap}
.bar-outline-btn.is-accent,.bar-outline-btn[aria-pressed="true"]{border-color:var(--bar-amber)}
.bar-lbl-short{display:none}
.bar-icon-btn{flex:none;background:transparent;border:1.5px solid var(--bar-line);color:#f8fafc;border-radius:10px;padding:5px 10px;cursor:pointer;font-size:18px;line-height:1}
.bar-row{flex:none;display:flex;align-items:center;gap:12px;margin:0 16px;padding:clamp(5px,.9vh,10px) 10px;background:rgba(15,31,63,.75);
  border:1px solid var(--bar-line);border-radius:14px;min-width:0}
.bar-home{flex:none;display:inline-flex;align-items:center;gap:8px;padding:clamp(5px,.9vh,9px) 16px;border-radius:10px;font-weight:800;font-size:clamp(14px,1.2vw,16px);cursor:pointer;
  background:transparent;color:#f8fafc;border:1.5px solid var(--bar-line)}
.bar-home svg{width:20px;height:20px}
.bar-home.is-on{background:var(--bar-amber);color:var(--on-brand,#152B52);border-color:var(--bar-amber)}
.bar-row-sep{flex:none;width:1px;height:28px;background:var(--bar-line)}
.bar-row-scroll{flex:1;min-width:0;display:flex;align-items:center;gap:10px;overflow-x:auto;white-space:nowrap;scrollbar-width:thin;padding:2px 0}
.bar-row-group{display:inline-flex;align-items:center;gap:8px}
.bar-zone{font-weight:700;font-size:14px;opacity:.95;padding:0 4px}
.bar-pill{flex:none;padding:clamp(5px,.8vh,8px) 14px;border-radius:10px;font-size:clamp(13px,1.1vw,15px);cursor:pointer;background:transparent;color:#f8fafc;border:1.5px solid rgba(248,250,252,.75)}
.bar-pill.has-bill{border-color:var(--bar-amber);color:var(--bar-amber)}
.bar-pill.is-on{background:var(--bar-amber);border-color:var(--bar-amber);color:var(--on-brand,#152B52);box-shadow:0 0 0 3px rgba(251,197,3,.35)}
.bar-msg{flex:none;margin:6px 16px 0;padding:6px 12px;border-radius:10px;font-size:14px;border:1px solid}
.bar-panel{flex:none;max-height:45%;overflow-y:auto;margin:8px 16px 0}
/* table / counter-tab view */
.bar-body{flex:1;min-height:0;display:flex;gap:clamp(10px,1.4vw,18px);padding:10px 12px 12px 16px}
.bar-left{flex:1;min-width:0;min-height:0;overflow-y:auto}
/* Home: the embedded POS fills one grid cell (its root is height:100%) */
.bar-home-body{flex:1;min-height:0;display:grid;grid-template-rows:minmax(0,1fr);grid-template-columns:minmax(0,1fr);padding-top:6px}
.bar-shift{margin-bottom:8px}
/* the quick-sell grid */
.bar-quick-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:2px 0 clamp(8px,1.4vh,14px)}
.bar-quick-title{margin:0;font-family:var(--font-display);font-weight:800;font-size:clamp(22px,2.6vw,38px);line-height:1.05;color:#fff}
.bar-quick-sub{font-size:clamp(13px,1.2vw,17px);opacity:.7;margin-top:2px}
.bar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(8px,1.1vw,14px)}
.bar-box{--box:#1d4ed8;--pic:34px;--name:15px;--price:12px;display:flex;align-items:center;gap:8px;min-width:0;
  min-height:clamp(92px,13vh,150px);padding:10px;border-radius:16px;cursor:pointer;text-align:left;color:#fff;
  background:var(--box);border:1.5px solid rgba(255,255,255,.35);
  background:linear-gradient(160deg,color-mix(in srgb,var(--box) 82%,#fff 18%) 0%,var(--box) 55%,color-mix(in srgb,var(--box) 80%,#000 20%) 100%);
  border:1.5px solid color-mix(in srgb,var(--box) 60%,#fff 40%);box-shadow:0 6px 18px rgba(0,0,0,.35);transition:transform .08s}
.bar-box:active{transform:scale(.97)}
.bar-box-pic{flex:none;width:var(--pic);height:calc(var(--pic) * 1.35);object-fit:contain;border-radius:10px}
.bar-box-icon{color:rgba(255,255,255,.92);padding:calc(var(--pic) * .1)}
.bar-box-emoji{display:flex;align-items:center;justify-content:center;font-size:calc(var(--pic) * .7)}
.bar-box-text{flex:1;display:flex;flex-direction:column;gap:clamp(4px,.8vh,10px);min-width:0;padding-left:8px;border-left:1.5px solid rgba(255,255,255,.35)}
.bar-box-name{font-family:var(--font-display);font-weight:800;font-size:var(--name);line-height:1.15;overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:break-word;word-break:break-word}
.bar-box-name.is-long{font-size:calc(var(--name) * .84)}
.bar-box-price{flex:none;align-self:flex-start;max-width:100%;font-weight:800;font-size:var(--price);padding:2px 7px;border-radius:9px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);white-space:nowrap}
.bar-empty{grid-column:1/-1;opacity:.7;padding:20px 0}
@media (min-width:600px){.bar-box{--pic:42px;--name:16px;--price:13px;gap:10px;padding:12px}.bar-box-text{padding-left:10px}.bar-box-price{padding:3px 9px}}
@media (min-width:900px){
  .bar-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .bar-box{--pic:clamp(38px,4vw,60px);--name:clamp(15px,1.5vw,21px);--price:clamp(12px,1.1vw,16px);gap:clamp(8px,.9vw,14px);padding:clamp(10px,1vw,14px)}
  .bar-box-text{padding-left:clamp(8px,.9vw,14px)}
}
@media (min-width:1366px){
  .bar-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
  .bar-box{--pic:clamp(46px,3.4vw,72px);--name:clamp(16px,1.25vw,24px);--price:clamp(13px,.95vw,17px)}
}
/* the cream cards */
.bar-card{background:#FBF3E4;color:#13203a;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column;min-height:0;min-width:0}
.bar-side-card{width:clamp(300px,32%,440px);flex:none}
.bar-card-head{flex:none;display:flex;align-items:center;gap:10px;padding:clamp(10px,1.6vh,18px) 18px clamp(6px,1vh,10px);font-family:var(--font-display);font-weight:800;font-size:clamp(18px,1.8vw,26px);min-width:0}
.bar-card-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-card-head svg{flex:none;width:26px;height:26px}
.bar-card-body{flex:1;min-height:0;padding:0 18px 10px;overflow-y:auto;display:grid;gap:8px;align-content:start}
.bar-card-foot{flex:none;display:grid;gap:8px;padding:10px 18px 14px;border-top:1px solid #e8dcc4}
.bar-card-foot:empty{display:none}
.bar-foot-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px;min-width:0}
.bar-foot-row .bar-total,.bar-foot-row .bar-money{flex:1;min-width:0}
.bar-card button.bar-cbtn{background:transparent;color:#13203a;border:1.5px solid #c9bfa9;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
.bar-card button.bar-cmain{background:var(--bar-amber);color:var(--on-brand,#152B52);border:none;border-radius:12px;padding:11px 16px;font-weight:800;font-size:16px;cursor:pointer}
.bar-card button:disabled{opacity:.5;cursor:not-allowed}
.bar-card select,.bar-card input{background:#fff;color:#13203a;border:1px solid #d8ccb3;border-radius:10px;padding:8px}
.bar-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #e8dcc4;font-size:15px;min-width:0}
.bar-line>*{min-width:0;overflow-wrap:anywhere}
.bar-draft-line>span:first-of-type{order:-1;flex:1 1 100%}
.bar-draft-line>span:nth-of-type(2){margin-left:auto}
/* portrait tablets (desktop shell, no phone bottom nav): the POS cart strip sits on the bottom edge */
.bar-shell button[aria-label="Open cart"],.bar-shell button[aria-label="Ouvrir le panier"]{bottom:0 !important}
.bar-total{display:flex;justify-content:space-between;align-items:baseline;gap:8px;background:#F4E7CF;border-radius:14px;padding:10px 14px;font-weight:800}
.bar-total b{font-size:clamp(18px,1.8vw,26px);white-space:nowrap}
.bar-money{background:#F4E7CF;border-radius:14px;padding:8px 14px;color:#13203a}
.bar-noshift{display:inline-block;padding:6px 10px;border-radius:10px;background:#fef3c7;border:1px solid #f59e0b;color:#92400e;font-size:12.5px;font-weight:700;white-space:nowrap}
.bar-approved{display:inline-block;padding:6px 10px;border-radius:10px;background:#dcfce7;border:1px solid #22c55e;color:#14532d;font-size:12.5px;font-weight:700}
.bar-bill-box{margin:12px 16px;max-width:560px}
/* the POS cart, re-pointed to the cream card (logic and markup unchanged) */
.bar-screen .bar-cart{--bg-surface:#FBF3E4;--bg-elevated:#F4E7CF;--bg-card:#fff8ec;--bg-base:#FBF3E4;--text-primary:#13203a;--text-secondary:#3b4660;
  --text-muted:#6b7280;--border:#e3d5ba;--border-hover:#cdbb98;--brand-light:#9a6b00;color:#13203a;
  width:clamp(300px,32%,440px);flex:none;min-width:0;margin:0 12px 12px 0;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.35);align-self:stretch}
.bar-screen .bar-cart *{min-width:0;max-width:100%}
.bar-screen .bar-cart .bar-pay-row>*{flex:1}
.bar-cart-customer{flex:none;padding:10px 14px 0}
.bar-cart-customer:empty{display:none}
/* below 900px: grid full width; the table card sits under it with its own capped height */
@media (max-width:899px){
  .bar-body{flex-direction:column;padding:8px 12px 12px}
  .bar-left{flex:1 1 0;min-height:110px}
  .bar-side-card{width:auto;max-height:58%}
}
@media (max-width:767px){
  .bar-menu-btn,.bar-brand,.bar-vsep{display:none}
  .bar-lbl-long{display:none}.bar-lbl-short{display:inline}
  .bar-top{padding:8px 12px}.bar-row{margin:0 12px;gap:8px;padding:6px 8px}.bar-home{padding:6px 12px}
  .bar-panel{margin:8px 12px 0}
}
`;
