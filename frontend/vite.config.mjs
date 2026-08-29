import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  appType: "spa",
  plugins: [
    react(),
    {
      name: "reset-spa-fallback",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const path = String(req.url || "").split("?")[0];
          if (path === "/reset" || path.startsWith("/reset/") || path === "/admin-recovery") req.url = "/index.html";
          next();
        });
      },
      closeBundle() {
        const index = resolve("dist/index.html");
        if (existsSync(index)) copyFileSync(index, resolve("dist/404.html"));
      }
    }
  ],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/uploads": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/register": { target: "http://127.0.0.1:3000", changeOrigin: true }
    }
  }
});
