import { defineConfig } from 'vitest/config';
// 20 s: every atomic write fsyncs file and folder, which is slow when hundreds of test files write at once.
export default defineConfig({ test: { globals: true, include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 20_000 } });
