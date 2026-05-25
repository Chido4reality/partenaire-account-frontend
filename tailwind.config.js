/** @type {import('tailwindcss').Config} */
// MP-MOBILE-UI-PHASE-1: Tailwind wired alongside the existing inline-
// style + CSS-variable system. Preflight is OFF so Tailwind's global
// margin/padding/font reset doesn't shift any existing pages — only new
// mobile-shell components (NavDrawer, NavItem, etc.) use Tailwind
// utilities. Existing components keep their inline styles + .btn/.card
// helpers from index.css.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
