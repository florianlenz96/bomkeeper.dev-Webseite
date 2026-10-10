import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createHandlers } from "../src/waitlist.js";
import { WaitlistStore } from "../src/storage.js";
import { signToken, verifyToken } from "../src/tokens.js";

class MemoryTable {
  records = new Map();
  revision = 0;
  key(partition, row) { return `${partition}:${row}`; }
  error(statusCode, code = "UpdateConditionNotSatisfied") {
    return Object.assign(new Error(code), { statusCode, code });
  }
  async getEntity(partition, row) {
    const record = this.records.get(this.key(partition, row));
    if (!record) throw this.error(404, "ResourceNotFound");
    return { ...record };
  }
  async createEntity(record) {
    const key = this.key(record.partitionKey, record.rowKey);
    if (this.records.has(key)) throw this.error(409, "EntityAlreadyExists");
    this.records.set(key, { ...record, etag: String(++this.revision) });
  }
  async updateEntity(record, mode, options) {
    const existing = this.records.get(this.key(record.partitionKey, record.rowKey));
    if (!existing) throw this.error(404, "ResourceNotFound");
    if (existing.etag !== options.etag) throw this.error(412);
    this.records.set(this.key(record.partitionKey, record.rowKey), {
      ...(mode === "Merge" ? existing : {}), ...record, etag: String(++this.revision),
    });
  }
  async deleteEntity(partition, row, options) {
    const existing = this.records.get(this.key(partition, row));
    if (!existing) throw this.error(404, "ResourceNotFound");
    if (existing.etag !== options.etag) throw this.error(412);
    this.records.delete(this.key(partition, row));
  }
}

const secret = "test-secret-that-is-at-least-32-characters";
const baseUrl = "https://bomkeeper.dev";
const defaultForm = {
  email: "user@example.com", company: "Example", type: "SaaS",
  consent: "yes", design_partner: "on", website: "",
};
function fixture(overrides = {}) {
  const table = new MemoryTable();
  const limits = new MemoryTable();
  const store = new WaitlistStore(table, limits);
  const emails = [];
  const logs = [];
  let time = Date.UTC(2026, 9, 9, 12);
  const context = {
    invocationId: "test",
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const handlers = createHandlers({
    config: {
      baseUrl, secret, sender: "waitlist@bomkeeper.dev", emailEnabled: true,
      allowedOrigins: [baseUrl, "https://www.bomkeeper.dev"], hourlyEmailLimit: 20,
      ...overrides.config,
    },
    store,
    sendEmail: overrides.sendEmail ?? (async (message) => { emails.push(message); }),
    now: () => time,
  });
  const post = (path, form, headers = {}) => new Request(`${baseUrl}${path}`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
  });
  const register = (form = {}, headers = {}) => handlers.register(post("/api/waitlist", { ...defaultForm, ...form }, headers), context);
  const token = (purpose) => {
    const link = emails.at(-1).content.plainText.match(new RegExp(`https://[^\\s]+/${purpose}\\?token=([^\\s]+)`));
    return link[1];
  };
  const action = (purpose, value, method = "POST") => handlers[purpose](
    method === "GET" ? new Request(`${baseUrl}/api/waitlist/${purpose}?token=${value}`) :
      post(`/api/waitlist/${purpose}`, { token: value }), context,
  );
  return { table, limits, store, emails, logs, context, post, register, token, action,
    advance: (milliseconds) => { time += milliseconds; },
    time: () => time,
  };
}

test("registration, explicit double opt in and unsubscribe lifecycle", async () => {
  const f = fixture();
  assert.equal((await f.register({ email: " User@Example.com " })).status, 200);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].senderAddress, "waitlist@bomkeeper.dev");
  const record = [...f.table.records.values()][0];
  assert.equal(record.email, "user@example.com");
  assert.equal(record.status, "pending");
  assert.equal(record.designPartner, true);
  assert.equal(record.consentVersion, "waitlist-2026-10");
  assert.equal(record.rowKey, createHash("sha256").update(record.email).digest("hex"));
  assert.equal((await f.action("confirm", f.token("confirm"), "GET")).status, 200);
  assert.equal((await f.store.get(record.rowKey)).status, "pending", "email scanners must not confirm");
  const confirmed = await f.action("confirm", f.token("confirm"));
  assert.equal(confirmed.status, 200);
  assert.match(confirmed.body, /You&#39;re on the list/);
  assert.equal((await f.store.get(record.rowKey)).status, "confirmed");
  assert.equal((await f.action("confirm", f.token("confirm"))).status, 200, "confirmation is idempotent");
  assert.equal((await f.action("unsubscribe", f.token("unsubscribe"), "GET")).status, 200);
  assert.equal(f.table.records.size, 1, "email scanners must not unsubscribe");
  assert.equal((await f.action("unsubscribe", f.token("unsubscribe"))).status, 200);
  assert.equal(f.table.records.size, 0);
  assert.equal((await f.action("unsubscribe", f.token("unsubscribe"))).status, 200);
});

test("duplicates and concurrent signups send only one email", async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.register()));
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(f.emails.length, 1);
  await f.action("confirm", f.token("confirm"));
  f.advance(3_600_001);
  await f.register();
  assert.equal(f.emails.length, 1, "confirmed users do not receive repeated confirmation emails");
});

test("cooldown, replacement and expiration prevent replay", async () => {
  const f = fixture();
  await f.register();
  const oldConfirm = f.token("confirm");
  const oldUnsubscribe = f.token("unsubscribe");
  await f.register();
  assert.equal(f.emails.length, 1);
  f.advance(3_600_001);
  await f.register();
  assert.equal(f.emails.length, 2);
  assert.equal((await f.action("confirm", oldConfirm)).status, 400);
  assert.equal((await f.action("unsubscribe", oldUnsubscribe)).status, 400);
  f.advance(48 * 3_600_000);
  assert.equal((await f.action("confirm", f.token("confirm"))).status, 400);
});

test("validate consent, email, company, product type and checkbox values", async () => {
  const f = fixture();
  for (const form of [
    { consent: "" }, { email: "bad" }, { email: "a@-invalid.example" },
    { email: `${"a".repeat(65)}@example.com` }, { company: "a".repeat(201) },
    { company: "company\nname" }, { type: "unknown" }, { design_partner: "yes" },
    { website: "https://bot.example" },
  ]) {
    assert.equal((await f.register(form)).status, 400);
  }
  assert.equal(f.emails.length, 0);
  assert.equal(f.table.records.size, 0);
  assert.ok(f.logs.length > 0);
});

test("reject cross-origin, missing origin, JSON, oversized and duplicate fields", async () => {
  const f = fixture();
  assert.equal((await f.register({}, { origin: "https://evil.example" })).status, 403);
  assert.equal((await f.register({}, { origin: "" })).status, 403);
  assert.equal((await f.register({}, { "content-type": "application/json" })).status, 415);
  assert.equal((await f.register({}, { "content-length": "9000" })).status, 413);
  assert.equal((await f.register({ company: "x".repeat(9000) })).status, 413);
  const request = f.post("/api/waitlist", { ...defaultForm });
  const duplicated = new Request(request.url, {
    method: "POST", headers: request.headers, body: `${await request.text()}&email=other@example.com`,
  });
  const handlers = createHandlers({
    config: { allowedOrigins: [baseUrl] }, store: f.store,
  });
  assert.equal((await handlers.register(duplicated, f.context)).status, 400);
  assert.equal(f.emails.length, 0);
  assert.equal((await f.register({}, { origin: "https://www.bomkeeper.dev" })).status, 200);
});

test("global persistent email budget is atomic and resets next hour", async () => {
  const f = fixture({ config: { hourlyEmailLimit: 2 } });
  const results = await Promise.all(["one", "two", "three", "four"].map((name) =>
    f.register({ email: `${name}@example.com` })));
  assert.equal(results.filter((result) => result.status === 200).length, 2);
  assert.equal(results.filter((result) => result.status === 429).length, 2);
  assert.equal(f.emails.length, 2);
  f.advance(3_600_000);
  assert.equal((await f.register({ email: "next@example.com" })).status, 200);
  assert.equal(f.limits.records.size, 1, "limit table must not grow each hour");
});

test("email disabled and SDK failures produce real errors without leaking secrets", async () => {
  const disabled = fixture({ config: { emailEnabled: false } });
  assert.equal((await disabled.register()).status, 503);
  assert.equal(disabled.table.records.size, 0);
  let attempts = 0;
  const failed = fixture({ sendEmail: async () => {
    attempts++;
    throw Object.assign(new Error("secret connection string and user@example.com"), { code: "EmailFailure" });
  } });
  assert.equal((await failed.register()).status, 503);
  assert.equal(attempts, 1);
  failed.advance(60_001);
  assert.equal((await failed.register()).status, 503);
  assert.equal(attempts, 2, "failed deliveries can be retried after a minute");
  assert.match(JSON.stringify(failed.logs), /EmailFailure/);
  assert.doesNotMatch(JSON.stringify(failed.logs), /secret connection|user@example/);
});

test("storage outages are not treated as missing entities or success", async () => {
  const f = fixture();
  f.table.getEntity = async () => { throw Object.assign(new Error("missing table"), { statusCode: 404, code: "TableNotFound" }); };
  assert.equal((await f.register()).status, 503);
  assert.equal(f.emails.length, 0);
  assert.match(JSON.stringify(f.logs), /TableNotFound/);
});

test("SDK service codes in details are logged without response bodies or credentials", async () => {
  const f = fixture();
  f.table.getEntity = async () => {
    throw Object.assign(new Error("secret connection string and user@example.com"), {
      statusCode: 404,
      details: { errorCode: "TableNotFound", odataError: { message: "secret response body" } },
    });
  };
  assert.equal((await f.register()).status, 503);
  assert.match(JSON.stringify(f.logs), /TableNotFound/);
  assert.doesNotMatch(JSON.stringify(f.logs), /secret|user@example/);
  assert.equal(f.emails.length, 0);
});

test("both Azure entity-not-found error variants allow initial registration", async () => {
  for (const code of ["ResourceNotFound", "EntityNotFound"]) {
    const f = fixture();
    for (const table of [f.table, f.limits]) {
      const get = table.getEntity.bind(table);
      table.getEntity = async (...args) => {
        try {
          return await get(...args);
        } catch (error) {
          if (error.statusCode === 404) error.code = code;
          throw error;
        }
      };
    }
    assert.equal((await f.register()).status, 200);
    assert.equal(f.emails.length, 1);
  }
});

test("unsubscribe remains usable long term and cannot delete a later signup", async () => {
  const f = fixture();
  await f.register();
  const oldUnsubscribe = f.token("unsubscribe");
  await f.action("confirm", f.token("confirm"));
  f.advance(2 * 365 * 24 * 3_600_000);
  assert.equal((await f.action("unsubscribe", oldUnsubscribe)).status, 200);
  await f.register();
  assert.equal((await f.action("unsubscribe", oldUnsubscribe)).status, 400);
  assert.equal(f.table.records.size, 1);
});

test("tokens enforce purpose, signature, shape and exact expiry", () => {
  const record = { rowKey: "a".repeat(64), generation: "b".repeat(64) };
  const token = signToken(secret, record, "confirm", 1000);
  assert.equal(verifyToken(secret, token, "confirm", 999).id, record.rowKey);
  assert.equal(verifyToken(secret, token, "confirm", 1000), null);
  assert.equal(verifyToken(secret, token, "unsubscribe", 999), null);
  assert.equal(verifyToken("another-secret", token, "confirm", 999), null);
  assert.equal(verifyToken(secret, `${token}x`, "confirm", 999), null);
  for (const invalid of [null, "", "a.b.c", ".".repeat(1100), "💥.x"]) {
    assert.equal(verifyToken(secret, invalid, "confirm", 0), null);
  }
});
