import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { alphaTab } from '@coderline/alphatab-vite';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// alphaTab's plugin copies its bundled SoundFont into public/ on every build. The app plays MuseScore General instead, and
// the Sonivox file's provenance is undocumented, so keep it out of the shipped build. Dev pages still read it from public/.
function dropUnusedSoundfont(): Plugin {
  let outDir = '';
  return {
    name: 'drop-unused-soundfont',
    apply: 'build',
    configResolved(config) { outDir = join(config.root, config.build.outDir); },
    closeBundle() { rmSync(join(outDir, 'soundfont'), { recursive: true, force: true }); },
  };
}

// Relative base keeps the bundle working under a GitHub Pages project path.
export default defineConfig(({ mode }) => {
  // .env / .env.local values (VITE_ prefix) are not in process.env, so load them here; real environment variables still win.
  // Tests skip the files so a local key never leaks into them.
  const env = { ...(mode === 'test' ? {} : loadEnv(mode, process.cwd(), 'VITE_')), ...process.env };
  return {
  base: './',
  // YouTube search and import is shown by default; build with VITE_ENABLE_YOUTUBE=false to hide it.
  // VITE_DEV_PRO=1 makes a local browser session behave as Pro (the web is otherwise Free-only). Never set it for a release build.
  define: {
    __YOUTUBE_ENABLED__: JSON.stringify(env.VITE_ENABLE_YOUTUBE !== 'false'),
    __DEV_PRO__: JSON.stringify(env.VITE_DEV_PRO === '1'),
    // The YouTube Data API key for in-app search; without one, search is hidden and pasting a link still works.
    __YOUTUBE_API_KEY__: JSON.stringify(env.VITE_YOUTUBE_API_KEY ?? ''),
  },
  plugins: [react(), alphaTab(), dropUnusedSoundfont()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
};
});
