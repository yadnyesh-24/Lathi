import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: false },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep the map engine in its own cacheable chunk.
        manualChunks: { maplibre: ["maplibre-gl"], react: ["react", "react-dom"] },
      },
    },
  },
});
