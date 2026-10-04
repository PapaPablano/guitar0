import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

// Relative base keeps the bundle working under a GitHub Pages project path.
export default defineConfig({
  base: './',
  // YouTube search and import is built but hidden; build with VITE_ENABLE_YOUTUBE=true to show it.
  define: { __YOUTUBE_ENABLED__: JSON.stringify(process.env.VITE_ENABLE_YOUTUBE === 'true') },
  plugins: [react(), alphaTab()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
