import { defineConfig } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(() => {
  const target = process.env.BUILD_TARGET;

  // Library build: renderer component
  if (target === "renderer") {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, "src/renderer/index.js"),
          name: "StruktolabRenderer",
          formats: ["umd", "es"],
          fileName: (format) => `struktolab-renderer.${format}.js`,
        },
        outDir: "dist/renderer",
        emptyOutDir: true,
      },
    };
  }

  // Library build: the DOM-free core, for Node consumers
  if (target === "core") {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, "src/core/index.js"),
          name: "StruktolabCore",
          formats: ["umd", "es"],
          fileName: (format) => `struktolab-core.${format}.js`,
        },
        outDir: "dist/core",
        emptyOutDir: true,
      },
    };
  }

  // Library build: editor component
  if (target === "editor") {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, "src/editor/index.js"),
          name: "StruktolabEditor",
          formats: ["umd", "es"],
          fileName: (format) => `struktolab-editor.${format}.js`,
        },
        outDir: "dist/editor",
        emptyOutDir: true,
      },
    };
  }

  throw new Error(
    "Set BUILD_TARGET to 'editor', 'renderer' or 'core'. The web app lives in platforms/web.",
  );
});
