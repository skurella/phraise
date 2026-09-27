import { defineConfig } from 'vite';

// Vanilla TypeScript page, built from web/ into ../dist (served by
// server/main.ts's static file handler). No dev server is used: the page is
// always built and served through server/main.ts, in both `npm run gates`
// and `npm start`.
export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
