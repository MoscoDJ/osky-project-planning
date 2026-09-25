import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

// Solo "electron" queda externo: el resto se empaqueta en out/ para que la app
// instalada no dependa de node_modules.
export default defineConfig({
  main: {
    build: {
      lib: { entry: "app/main/index.ts" },
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  preload: {
    build: {
      lib: { entry: "app/preload/index.ts" },
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: "app/renderer",
    plugins: [react()],
    build: { rollupOptions: { input: "app/renderer/index.html" } },
    server: { fs: { allow: ["."] } },
  },
});
