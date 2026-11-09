import { defineConfig } from 'vitest/config';

// Runs the generator tests against the compiled Wasm module in Node.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
});
