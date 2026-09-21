import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // PAPI ships some code that expects Node globals; this keeps the browser build happy.
  define: { global: "globalThis" },
});
