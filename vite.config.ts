import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web"),
    },
  },

  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `tauri` and agent-only repo docs
      ignored: [
        "**/tauri/**",
        "**/AGENTS.md",
        "**/module-agents-template.md",
      ],
    },
  },

  build: {
    modulePreload: {
      polyfill: false,
      // The Monaco chunk is intentionally lazy (only loads when an editor
      // mounts); exclude it from HTML modulepreload so first paint does not
      // fetch and parse it eagerly.
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !dep.includes('/monaco-')),
    },
    rollupOptions: {
      output: {
        // Split rarely-changing vendors into stable chunks so the webview can
        // reuse them across app updates and parse less JS on first paint.
        // Monaco (editors) and react-markdown stay in their own lazy chunks
        // via the `lazyMonaco` wrappers and are NOT grouped here.
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }
          if (id.includes('/monaco-editor/') || id.includes('react-monaco-editor')) {
            return 'monaco';
          }
          if (
            id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/') || id.includes('/zustand/')
          ) {
            return 'react-vendor';
          }
          if (
            id.includes('/antd/') || id.includes('/@ant-design/') || id.includes('/rc-') || id.includes('/@rc-component/')
          ) {
            return 'antd-vendor';
          }
          return undefined;
        },
      },
    },
  },
}));
