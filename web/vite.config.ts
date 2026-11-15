import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the static build works on Vercel (see vercel.json) or under any sub-path.
  base: './',
});
