// Vite build for the Worker. The Cloudflare plugin runs the server build in workerd.
// It must come before the React Router plugin so the two share the `ssr` environment.
import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
    }),
    reactRouter(),
  ],
  server: { port: 5173, strictPort: true },
});
