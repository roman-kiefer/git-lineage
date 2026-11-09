import { defineConfig } from 'vitest/config';

// Tests run in Node by default; DOM tests choose happy-dom with a comment at the top.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Many tests run real git against throwaway repositories; under load 5 s was sometimes too short.
    testTimeout: 20_000,
  },
});
