import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        name: "YourFitnessPal",
        short_name: "YFP",
        description: "Track meals, macros, and weight without ads or paywalls.",
        theme_color: "#fdf7e8",
        background_color: "#fdf7e8",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        importScripts: ["push-sw.js"],
        globPatterns: ["**/*.{js,css,html,png,webp,svg,ico}"],
        // App shell (HTML/JS/CSS/etc.) is precached and served cache-first
        // by the default globPatterns/navigateFallback behavior.
        // Top-level navigations to server routes must reach the network, not
        // the precached SPA shell -- /authorize in particular is where the AI
        // client sends the browser to start the OAuth flow.
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/authorize/, /^\/token/, /^\/register/, /^\/revoke/, /^\/\.well-known\//],
        runtimeCaching: [
          {
              // Search/barcode are shared; /recent is user-specific. Logout
              // also clears this cache explicitly.
              urlPattern: ({ url }) =>
                url.pathname === "/api/foods/search" || url.pathname.startsWith("/api/foods/barcode/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-foods-cache",
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 1 week
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    // For `npm run dev`: forward API calls to a locally-running backend
    // (e.g. `uvicorn app.main:app` on its default port). In the Docker
    // Compose deployment, nginx handles this proxying instead (see
    // nginx.conf) and this block is unused.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
