import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/uploads": "http://127.0.0.1:3001",
    },
  },
});
