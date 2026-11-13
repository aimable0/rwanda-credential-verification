import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: {
      // Keep test output readable; logger.test.ts sets its own level.
      LOG_LEVEL: "silent",
      AUTH_SECRET: "test-secret-not-used-anywhere-else",
      FRONTEND_URL: "http://localhost:5173",
    },
    restoreMocks: true,
  },
});
