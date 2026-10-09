import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

const env = {
  WAITLIST_BASE_URL: "https://bomkeeper.dev",
  WAITLIST_ALLOWED_ORIGINS: "https://bomkeeper.dev,https://www.bomkeeper.dev",
  WAITLIST_TOKEN_SECRET: "a".repeat(64),
  WAITLIST_SENDER: "waitlist@bomkeeper.dev",
  WAITLIST_EMAIL_ENABLED: "true",
  WAITLIST_EMAIL_CONNECTION_STRING: "email-connection",
  WAITLIST_STORAGE_CONNECTION_STRING: "storage-connection",
  WAITLIST_TABLE: "Waitlist",
  WAITLIST_LIMITS_TABLE: "WaitlistLimits",
  WAITLIST_HOURLY_EMAIL_LIMIT: "20",
};

test("production settings match infrastructure contract", () => {
  const config = loadConfig(env);
  assert.equal(config.baseUrl, "https://bomkeeper.dev");
  assert.equal(config.hourlyEmailLimit, 20);
  assert.equal(config.emailEnabled, true);
  assert.equal(config.emailConnection, "email-connection");
  assert.equal(config.tableName, "Waitlist");
  assert.deepEqual(config.allowedOrigins, ["https://bomkeeper.dev", "https://www.bomkeeper.dev"]);
});

test("disabled email requires no connection and localhost development works", () => {
  const config = loadConfig({
    ...env, WAITLIST_BASE_URL: "http://localhost:4280",
    WAITLIST_ALLOWED_ORIGINS: "http://localhost:4280",
    WAITLIST_EMAIL_ENABLED: "false", WAITLIST_EMAIL_CONNECTION_STRING: "",
  });
  assert.equal(config.emailEnabled, false);
  assert.equal(config.emailConnection, null);
});

test("missing settings and unsafe origins fail closed", () => {
  for (const name of Object.keys(env)) {
    assert.throws(() => loadConfig({ ...env, [name]: "" }));
  }
  for (const overrides of [
    { WAITLIST_BASE_URL: "http://bomkeeper.dev" },
    { WAITLIST_BASE_URL: "https://bomkeeper.dev/path" },
    { WAITLIST_BASE_URL: "https://user:password@bomkeeper.dev" },
    { WAITLIST_ALLOWED_ORIGINS: "*" },
    { WAITLIST_ALLOWED_ORIGINS: "https://bomkeeper.dev/" },
    { WAITLIST_ALLOWED_ORIGINS: "https://other.example" },
    { WAITLIST_TOKEN_SECRET: "short" },
    { WAITLIST_HOURLY_EMAIL_LIMIT: "0" },
    { WAITLIST_HOURLY_EMAIL_LIMIT: "1001" },
    { WAITLIST_HOURLY_EMAIL_LIMIT: "2.5" },
    { WAITLIST_EMAIL_ENABLED: "yes" },
  ]) {
    assert.throws(() => loadConfig({ ...env, ...overrides }));
  }
});
