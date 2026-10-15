import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environmentOptions: {
      happyDOM: { url: 'https://example.com/' },
    },
  },
});
