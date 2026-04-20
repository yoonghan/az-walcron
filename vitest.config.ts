import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      COSMOS_ENDPOINT: 'https://fake.cosmos.azure.com',
      COSMOS_DATABASE: 'db1',
      COSMOS_CONTAINER: 'c1'
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tracing.ts', 'src/**/*.test.ts']
    }
  }
});
