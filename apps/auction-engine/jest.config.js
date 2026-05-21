/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: {
    // ts-jest picks up isolatedModules from tsconfig.json — per-file
    // transpile, no full type-check, avoids rootDir conflicts with src/.
    "^.+\\.ts$": ["ts-jest", {}],
  },
};
