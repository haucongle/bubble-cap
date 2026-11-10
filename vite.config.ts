import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Trên GitHub Pages (project site) app nằm ở /<ten-repo>/ nên workflow truyền VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
});
