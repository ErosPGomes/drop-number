import { defineConfig } from 'vitest/config';

// base './' produz caminhos relativos: o mesmo build roda em GitHub Pages (subpasta),
// em qualquer host estático ou aberto a partir de um WebView.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
