import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// COOP/COEP headers (D-010): enables SharedArrayBuffer/multithreaded WASM for
// local inference from M2/M3. Third-party scripts must stay CORP-compatible.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ES-format workers: the Kokoro inference worker (D-003) relies on dynamic
  // import() for ONNX Runtime backend loading, which requires module workers.
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
    headers: isolationHeaders,
  },
  preview: {
    port: 4173,
    headers: isolationHeaders,
  },
});
