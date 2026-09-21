import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // PAPI ships WASM-adjacent ESM that Vite should not try to pre-bundle aggressively.
  optimizeDeps: { exclude: ["@kollectyve/chain-descriptors"] },
});
