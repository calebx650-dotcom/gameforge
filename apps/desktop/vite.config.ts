import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev-server port and a relative base so the
// built assets load correctly from the webview.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    port: 4311,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
