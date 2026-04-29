import { relative } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const shouldIgnoreWatchPath = (watchedPath: string) => {
  const relativePath = relative(projectRoot, watchedPath).replaceAll("\\", "/");

  if (relativePath === "" || relativePath === ".") {
    return false;
  }

  if (relativePath === "index.html") {
    return false;
  }

  if (relativePath === ".dev.vars") {
    return false;
  }

  return relativePath !== "src" && !relativePath.startsWith("src/");
};

// E2E suite seeds an isolated D1/KV/R2 state directory per run; the
// FLAMEMAIL_E2E_PERSIST_PATH env points the cloudflare-vite plugin at
// that directory so vite/miniflare share the same state that
// `wrangler ... migrations apply --persist-to` wrote. Local dev leaves
// the env unset and uses the default `.wrangler/state` path.
const e2ePersistStatePath = process.env.FLAMEMAIL_E2E_PERSIST_PATH;

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    cloudflare({
      ...(e2ePersistStatePath ? { persistState: { path: e2ePersistStatePath } } : {}),
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: true,
    watch: {
      ignored: shouldIgnoreWatchPath,
    },
  },
});
