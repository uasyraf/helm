import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // pg and drizzle-orm/node-postgres are only loaded when HELM_DB_URL is a Postgres URL;
  // tell Vite to treat them as external so a missing optional dep doesn't break the SSR build.
  ssr: {
    external: ["pg", "drizzle-orm/node-postgres"],
  },
  build: {
    rollupOptions: {
      external: ["pg", "drizzle-orm/node-postgres"],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4400,
    strictPort: false,
  },
});
