import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { root: '.', include: ['tests/**/*.test.ts'], fileParallelism: false, testTimeout: 20000 } });
