// @ts-check
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * The repository previously had no linter at all, yet the source already carried
 * `// eslint-disable-next-line react-hooks/exhaustive-deps` comments — they were
 * inert. That rule is the main reason this config exists: the app leans heavily
 * on refs to dodge stale closures (`settingsRef`, `handleCaptureRef`,
 * `activeCaptureModeRef`, `registeredShortcutsRef`), which is exactly the code
 * where a missing dependency turns into a capture firing with last week's
 * settings.
 *
 * Severity policy: rules that catch real defects are errors. Rules that are
 * stylistic, or that would require reworking existing working code, are warnings
 * so they surface in review without blocking CI on a pre-existing backlog.
 */
export default tseslint.config(
  {
    // Generated, vendored, or not ours. `.kilo/worktrees/` holds full checkouts
    // of this same repo, so without it every finding is reported twice.
    ignores: [
      "dist/",
      "node_modules/",
      "src-tauri/",
      "public/",
      "coverage/",
      "flatpak/",
      "packaging/",
      "scripts/",
      ".kilo/",
      ".workbuddy-ai/",
      "*.config.js",
      "*.config.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // ── Correctness: these catch real bugs, so they fail the build ──────────
      // Conditionally-called hooks corrupt React's hook order.
      "react-hooks/rules-of-hooks": "error",
      // `catch {}` that swallows everything is already used deliberately in a few
      // places, but an empty block elsewhere is nearly always a mistake.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // `==` against null is idiomatic; every other loose comparison is not.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "no-unsafe-optional-chaining": "error",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      // ── React Compiler rules (eslint-plugin-react-hooks v7) ────────────────
      // Errors, not warnings: the tree is clean of all of them, so this holds
      // the line rather than accumulating a backlog. They were worked down by
      // deriving state instead of resetting it from effects — see
      // `ImageEditor`, `QuickOverlay`, `RightSidebar` and `motion.tsx`, each of
      // which also fixed a real first-frame flash — and by deleting three dead
      // hooks that the Zustand store had superseded.
      //
      // If one of these is genuinely wrong for a call site, suppress it inline
      // with a comment saying why. There is exactly one such suppression today
      // (the global-shortcut cleanup in App.tsx, where the ref is populated
      // asynchronously and the rule's suggested fix would leak registrations).
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Tests legitimately reach for `any` and non-null assertions.
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // `react-refresh/only-export-components` protects Vite's Fast Refresh, which
    // can only swap a module whose exports are all components. These three cases
    // are not that kind of module:
    //
    //  - `main.tsx` is the entry point. It calls createRoot and exports nothing;
    //    Fast Refresh never applies to it.
    //  - `components/ui/*` is shadcn/ui, whose convention is to export the
    //    component together with its `cva` variants (`buttonVariants`). Splitting
    //    them would diverge from upstream for no benefit.
    //  - `BackgroundSelector.tsx` exports the `gradientOptions` catalogue next to
    //    the component that renders it.
    //
    // The cost is a full reload instead of a hot swap when these specific files
    // are edited, which is the correct trade here.
    files: ["src/main.tsx", "src/components/ui/*.tsx", "src/components/editor/BackgroundSelector.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  }
);
