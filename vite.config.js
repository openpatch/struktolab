import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
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

  // Default: app build (index.html + documentation.html)
  return {
    root: ".",
    build: {
      outDir: "build",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          documentation: resolve(__dirname, "documentation.html"),
        },
      },
    },
    server: {
      port: 8080,
      open: true,
    },
  };
});
