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
        const url = req.url ?? "";
        const isAsset = url.includes(".") || url.startsWith("/@") || url.startsWith("/src/");
        // "/" stays on the landing page; every other extensionless route is a
        // client-side app route and must boot the SPA shell.
        if (url !== "/" && !isAsset) req.url = "/app.html";
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
      },
    },
  },
  server: {
    port: 5173,
  },
});
