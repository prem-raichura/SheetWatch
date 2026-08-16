import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Two entries: index.html is the static public landing page (no JS, crawlable —
// Google's OAuth review reads it to confirm the app name and purpose), app.html
// is the React SPA. In production Vercel serves index.html at "/" from the
// filesystem and rewrites every unmatched path to /app.html.
const spaFallbackToAppHtml = {
  name: "spa-fallback-to-app-html",
  configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use(
      (req: { url?: string }, _res: unknown, next: () => void) => {
        // Strip the query string first — matching on the raw url only works
        // while the sole test is "contains a dot".
        const path = (req.url ?? "").split("?")[0];
        const isAsset =
          path.includes(".") || path.startsWith("/@") || path.startsWith("/src/");
        // The ops dashboard is its own entry, not a route in the SPA.
        if (path === "/admin" || path.startsWith("/admin/")) req.url = "/admin.html";
        // "/" stays on the landing page; every other extensionless route is a
        // client-side app route and must boot the SPA shell.
        else if (path !== "/" && !isAsset) req.url = "/app.html";
        next();
      }
    );
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), spaFallbackToAppHtml],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        app: path.resolve(__dirname, "app.html"),
        admin: path.resolve(__dirname, "admin.html"),
      },
    },
  },
  server: {
    port: 5173,
  },
});
