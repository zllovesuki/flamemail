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

export default defineConfig({
  plugins: [tailwindcss(), react(), cloudflare()],
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
