import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { EmailClient } from "@azure/communication-email";
import { confirmationContent, submitEmail } from "../src/email.js";

test("HTML email uses Bomkeeper colors, actionable links and plain-text fallback", () => {
  const confirm = 'https://bomkeeper.dev/confirm?token=test&value="quoted"';
  const unsubscribe = "https://bomkeeper.dev/unsubscribe?token=test&other=1";
  const content = confirmationContent(confirm, unsubscribe, "https://bomkeeper.dev");
  assert.match(content.html, /#0A0C1D/);
  assert.match(content.html, /#6EE7B7/);
  assert.match(content.html, /Confirm my signup/);
  assert.match(content.html, /48 hours/);
  assert.ok(content.html.includes('href="https://bomkeeper.dev/confirm?token=test&amp;value=&quot;quoted&quot;"'));
  assert.ok(content.html.includes('href="https://bomkeeper.dev/unsubscribe?token=test&amp;other=1"'));
  assert.ok(content.plainText.includes(confirm));
  assert.ok(content.plainText.includes(unsubscribe));
  assert.doesNotMatch(content.html, /<script|<img|@font-face/);
});

test("accepted email does not wait for completion polling", async () => {
  const message = { content: { plainText: "test" } };
  let called = false;
  await submitEmail({
    async beginSend(value, options) {
      assert.equal(value, message);
      assert.ok(options.abortSignal instanceof AbortSignal);
      called = true;
      return {
        getOperationState: () => ({ status: "running" }),
        pollUntilDone: () => assert.fail("must not poll for completion"),
      };
    },
  }, message);
  assert.ok(called);
});

test("email submission and immediate operation failures are propagated", async () => {
  const error = new Error("provider rejected submission");
  await assert.rejects(submitEmail({ beginSend: async () => { throw error; } }, {}), error);
  for (const state of [{ status: "failed" }, { status: "canceled" }, { error }]) {
    await assert.rejects(submitEmail({
      beginSend: async () => ({ getOperationState: () => state }),
    }, {}));
  }
});

test("real Email SDK returns while ACS operation is still running", async (t) => {
  const requests = [];
  const operationId = "00000000-0000-4000-8000-000000000001";
  const server = createServer((request, response) => {
    request.resume();
    requests.push(request.method);
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    response.writeHead(request.method === "POST" ? 202 : 200, {
      "Content-Type": "application/json",
      "Operation-Location": `${endpoint}/emails/operations/${operationId}?api-version=2023-03-31`,
    });
    response.end(JSON.stringify({ id: operationId, status: "Running" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const client = new EmailClient(
    `endpoint=http://127.0.0.1:${server.address().port};accesskey=${Buffer.alloc(32).toString("base64")}`,
    { allowInsecureConnection: true, retryOptions: { maxRetries: 0 } },
  );
  await submitEmail(client, {
    senderAddress: "waitlist@bomkeeper.dev",
    recipients: { to: [{ address: "user@example.com" }] },
    content: confirmationContent("https://bomkeeper.dev/confirm", "https://bomkeeper.dev/unsubscribe", "https://bomkeeper.dev"),
  });
  assert.equal(requests[0], "POST");
  assert.ok(requests.length <= 2, "only submission and the SDK's initial status check are allowed");
});
