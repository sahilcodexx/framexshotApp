import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  base: "./",
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    cssMinify: "lightningcss",
    minify: "esbuild",
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("node_modules")) {
            if (
              /\/node_modules\/.*(react|react-dom|scheduler|@radix-ui|lucide-react|motion|framer-motion|zustand|immer|clsx|tailwind-merge|sonner)\b/.test(normalized) ||
              /\/(react|react-dom|scheduler|@radix-ui|lucide-react|motion|framer-motion|zustand|immer)[@\/]/.test(normalized)
            ) {
              return "vendor-react";
            }
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
