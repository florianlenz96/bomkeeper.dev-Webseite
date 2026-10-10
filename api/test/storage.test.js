import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { TableClient } from "@azure/data-tables";
import { azureErrorCode, WaitlistStore } from "../src/storage.js";
import { createHandlers } from "../src/waitlist.js";

async function storageFixture(t, code, status = 404) {
  const writes = [];
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === "GET") {
      response.writeHead(status, {
        "Content-Type": "application/json",
        ...(code ? { "x-ms-error-code": code } : {}),
      });
      response.end(JSON.stringify({
        "odata.error": { code, message: { lang: "en-US", value: "Storage request failed" } },
      }));
    } else {
      writes.push(request.url);
      response.writeHead(204, { etag: '"test-etag"' });
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const options = { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } };
  const table = new TableClient(endpoint, "Waitlist", options);
  const limits = new TableClient(endpoint, "WaitlistLimits", options);
  return { store: new WaitlistStore(table, limits), table, writes };
}

test("real Table SDK missing-entity errors permit initial signup and budget creation", async (t) => {
  for (const code of ["ResourceNotFound", "EntityNotFound"]) {
    await t.test(code, async (t) => {
      const { store, table, writes } = await storageFixture(t, code);
      await assert.rejects(table.getEntity("waitlist", "new"), (error) => {
        assert.equal(error.code, undefined, "SDK stores the service code in details, not code");
        assert.equal(azureErrorCode(error), code);
        return true;
      });
      const emails = [];
      const handlers = createHandlers({
        config: {
          baseUrl: "https://bomkeeper.dev",
          allowedOrigins: ["https://bomkeeper.dev"],
          secret: "test-secret-that-is-at-least-32-characters",
          sender: "waitlist@bomkeeper.dev", emailEnabled: true, hourlyEmailLimit: 20,
        },
        store,
        sendEmail: async (message) => emails.push(message),
      });
      const response = await handlers.register(new Request("https://bomkeeper.dev/api/waitlist", {
        method: "POST",
        headers: { origin: "https://bomkeeper.dev", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: "user@example.com", type: "SaaS", consent: "yes" }),
      }), { warn: () => {}, error: () => assert.fail("registration must not log an error") });
      assert.equal(response.status, 200);
      assert.equal(emails.length, 1);
      assert.deepEqual(writes, ["/Waitlist", "/WaitlistLimits"]);
    });
  }
});

test("real Table SDK table outages and unknown 404s remain failures", async (t) => {
  for (const [code, status] of [["TableNotFound", 404], [undefined, 404], ["AuthenticationFailed", 403], ["ResourceNotFound", 500]]) {
    await t.test(`${code ?? "unknown"} ${status}`, async (t) => {
      const { store, writes } = await storageFixture(t, code, status);
      await assert.rejects(store.get("new"), (error) => error.statusCode === status);
      await assert.rejects(store.reserveEmail(Date.now(), 20), (error) => error.statusCode === status);
      assert.equal(writes.length, 0);
    });
  }
});
