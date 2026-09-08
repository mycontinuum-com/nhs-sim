import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "/control/",
  plugins: [react()],
  build: { outDir: "../../dist/sites/control", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/cis2": "http://localhost:8080",
      "/browser": "http://localhost:8080",
    },
  },
});
