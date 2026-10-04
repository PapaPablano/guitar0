import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';

// Relative base keeps the bundle working under a GitHub Pages project path.
export default defineConfig({
  base: './',
  plugins: [react(), alphaTab()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
