// Tailwind v4 is processed by @tailwindcss/vite in vite.config.ts,
// so this PostCSS config is intentionally a no-op. Kept as an empty
// ESM stub so Vite's CSS pipeline can still discover a postcss config
// and not fall back to a CJS re-parse path (which previously failed
// with "Identifier 'createRequire' has already been declared" — a
// dead createRequire import in the old file collided with Node 22's
// stricter ESM module loader).
export default {
  plugins: {},
};
