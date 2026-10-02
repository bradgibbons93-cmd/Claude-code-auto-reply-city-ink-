import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

/**
 * The test drive: the real app on pretend data (src/client/demo/), built into
 * a folder that works from any address — `npm run build:demo` → dist-demo/.
 *
 * The app refers to its pictures from the site root ("/home/reply.webp").
 * Hosted inside something else the root is somebody else's, so for this build
 * those become relative. And the real log-out reloads onto /login, which here
 * would leave the page; it starts the test drive over instead.
 */
function demoPaths(): Plugin {
  return {
    name: "runnit-demo-paths",
    enforce: "pre",
    transform(code, id) {
      if (!/src\/client\/.*\.(tsx?|css)$/.test(id)) return;
      let out = code.replace(/(["'`])\/(home|brand)\//g, "$1./$2/");
      if (id.endsWith(".css")) out = out.replace(/url\((["'])\.\/home\//g, "url($1../home/");
      out = out.replace(
        'window.location.replace("/login")',
        '((window as any).__runnitDemo ? (window as any).__runnitDemo.reset() : window.location.replace("/login"))'
      );
      return out === code ? undefined : { code: out, map: null };
    },
  };
}

/** The pretend studio's photos, next to the page. */
function demoImages(): Plugin {
  return {
    name: "runnit-demo-images",
    closeBundle() {
      const from = path.resolve(__dirname, "src/client/demo/images");
      const to = path.resolve(__dirname, OUT, "demo");
      fs.mkdirSync(to, { recursive: true });
      for (const file of fs.readdirSync(from)) fs.copyFileSync(path.join(from, file), path.join(to, file));
    },
  };
}

/** `DEMO_OUT` lets a studio's own test drive build beside the plain one. */
const OUT = process.env.DEMO_OUT || "dist-demo";

export default defineConfig({
  base: "./",
  plugins: [demoPaths(), react(), demoImages()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src/client") } },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, "demo.html") },
  },
});
