import { defineConfig } from 'vitest/config';
// Atomic writes skip fsync in tests (see src/shared/node/atomic-write.ts); durability tests turn it back on.
export default defineConfig({ test: { globals: true, include: ['tests/**/*.test.{ts,tsx}'], env: { PANDAFIT_UNSAFE_NO_FSYNC: '1' } } });
