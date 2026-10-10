import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../../website/waitlist.js", import.meta.url), "utf8");

function fixture(fetch, lang = "en") {
  const button = { textContent: "Join", disabled: false };
  const status = { textContent: "" };
  const attributes = new Map();
  let submit;
  const form = {
    action: "https://bomkeeper.dev/api/waitlist",
    querySelector: (selector) => selector === '[role="status"]' ? status : button,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    addEventListener: (name, callback) => { assert.equal(name, "submit"); submit = callback; },
  };
  runInNewContext(script, {
    document: { querySelector: () => form, documentElement: { lang } },
    window: { fetch },
    fetch,
    URLSearchParams,
    FormData: class {
      constructor(value) { assert.equal(value, form); }
      *[Symbol.iterator]() {
        yield ["email", "user@example.com"];
        yield ["consent", "yes"];
        yield ["type", "SaaS"];
      }
    },
  });
  return {
    button, status, attributes,
    submit: () => submit({ preventDefault() {} }),
  };
}

test("async form immediately shows progress and prevents duplicate submissions", async () => {
  let resolve;
  let calls = 0;
  const f = fixture(async (url, options) => {
    calls++;
    assert.equal(url, "https://bomkeeper.dev/api/waitlist");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Accept, "application/json");
    assert.equal(options.body.get("email"), "user@example.com");
    assert.equal(options.body.get("consent"), "yes");
    return new Promise((done) => { resolve = done; });
  });
  const pending = f.submit();
  assert.equal(f.button.disabled, true);
  assert.match(f.status.textContent, /Submitting/);
  assert.equal(f.attributes.get("aria-busy"), "true");
  await f.submit();
  assert.equal(calls, 1);
  resolve({ ok: true, json: async () => ({ message: "queued" }) });
  await pending;
  assert.match(f.status.textContent, /Check your inbox/);
  assert.equal(f.button.disabled, true);
  assert.equal(f.attributes.has("aria-busy"), false);
  await f.submit();
  assert.equal(calls, 1);
});

test("async form renders server errors as text and permits retries", async () => {
  const f = fixture(async () => ({ ok: false, status: 400, json: async () => ({ message: "<script>not HTML</script>" }) }));
  await f.submit();
  assert.equal(f.status.textContent, "<script>not HTML</script>");
  assert.equal(f.button.disabled, false);
  assert.equal(f.button.textContent, "Join");
  assert.equal(f.attributes.has("aria-busy"), false);
});

test("German async form localizes success, rate limits and server errors", async () => {
  for (const [ok, status, expected] of [[true, 200, /Posteingang/], [false, 429, /in einer Stunde/], [false, 503, /vorübergehend/], [false, 400, /Angaben/]]) {
    const f = fixture(async () => ({ ok, status, json: async () => ({ message: "English response" }) }), "de");
    await f.submit();
    assert.match(f.status.textContent, expected);
    assert.equal(f.button.disabled, ok);
  }
});

test("network and malformed responses never claim success and allow retry", async () => {
  for (const fetch of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: true, json: async () => { throw new Error("not JSON"); } }),
  ]) {
    const f = fixture(fetch);
    await f.submit();
    assert.match(f.status.textContent, /check your connection/);
    assert.equal(f.button.disabled, false);
    assert.equal(f.attributes.has("aria-busy"), false);
  }
});

test("both locale forms retain native submission and load the shared CSP-compatible script", async () => {
  for (const path of ["index.html", "de/index.html"]) {
    const html = await readFile(new URL(`../../website/${path}`, import.meta.url), "utf8");
    assert.match(html, /<script src="\/waitlist\.js" defer><\/script>/);
    assert.match(html, /<form action="\/api\/waitlist" method="post"/);
    assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  }
  assert.doesNotThrow(() => runInNewContext(script, { document: { querySelector: () => null } }));
  assert.doesNotThrow(() => runInNewContext(script, { document: { querySelector: () => ({}) }, window: {} }));
});
