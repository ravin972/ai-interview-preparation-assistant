import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: [
      'packages/*/test/**/*.test.{ts,tsx}',
      'apps/*/test/**/*.test.{ts,tsx}',
      'tools/*/test/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
    ],
    // Deterministic, offline test runs. No provider key is ever required by CI.
    env: { LLM_PROVIDER: 'mock' },
  },
});
