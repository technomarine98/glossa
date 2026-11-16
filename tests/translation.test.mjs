import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { build } from "vite";

// Bundle with the project's existing toolchain, without writing test artifacts.
const bundle = await build({
  configFile: false,
  publicDir: false,
  logLevel: "silent",
  build: {
    write: false,
    target: "es2022",
    minify: false,
    lib: { entry: "tests/entry.ts", formats: ["es"] },
  },
});
const output = Array.isArray(bundle) ? bundle[0] : bundle;
const code = output.output.find((item) => item.type === "chunk").code;
const {
  TranslationService, DEFAULT_SETTINGS, MyMemoryProvider, GoogleProvider,
  LibreTranslateProvider, RateLimitError, ProviderError, rateLimitError,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const now = Date.UTC(2026, 10, 16, 12);
const json = (data, init) => new Response(JSON.stringify(data), init);
const success = () => json({ responseStatus: 200, responseData: { translatedText: "Привет" } });
const signal = () => new AbortController().signal;
const translate = (service, text, options = {}) => service.translate(
  text, options.source ?? "auto", "ru", options.settings ?? DEFAULT_SETTINGS, options.signal ?? signal(),
);

const providers = [
  ["MyMemory", () => new MyMemoryProvider()],
  ["Google Cloud", () => new GoogleProvider("test-key")],
  ["LibreTranslate", () => new LibreTranslateProvider("https://example.test", "")],
];

for (const [name, create] of providers) {
  for (const body of ["json", "html"]) {
    test(`${name}: ${body} HTTP 429 preserves the server's cooldown`, async (t) => {
      t.mock.method(Date, "now", () => now);
      t.mock.method(globalThis, "fetch", async () => new Response(
        body === "json" ? JSON.stringify({ error: "Too many requests" }) : "<h1>Too many requests</h1>",
        { status: 429, headers: { "Retry-After": "120" } },
      ));
      await assert.rejects(create().translate("Hello", "en", "ru", signal()), (error) => {
        assert.ok(error instanceof RateLimitError);
        assert.equal(error.retryAt, now + 120_000);
        assert.match(error.message, /limiting requests/);
        return true;
      });
    });
  }
}

test("Retry-After supports HTTP dates and safe fallback values", (t) => {
  t.mock.method(Date, "now", () => now);
  for (const [header, expected] of [
    [new Date(now + 90_000).toUTCString(), now + 90_000],
    ["nonsense", now + 60_000],
    ["", now + 60_000],
    ["0", now + 1000],
    [new Date(now - 1000).toUTCString(), now + 1000],
    ["9".repeat(400), now + 60_000],
  ]) {
    const error = rateLimitError(new Response("", { headers: { "Retry-After": header } }), "Test");
    assert.equal(error.retryAt, expected);
  }
});

test("MyMemory: JSON quota errors are rejected even when HTTP succeeds", async (t) => {
  t.mock.method(Date, "now", () => now);
  const warning = "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 02 HOURS 03 MINUTES 04 SECONDS";
  t.mock.method(globalThis, "fetch", async () => json({
    responseStatus: "429", quotaFinished: true, responseData: { translatedText: warning },
  }));
  await assert.rejects(new MyMemoryProvider().translate("Hello", "en", "ru", signal()), (error) => {
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.dailyLimit, true);
    assert.equal(error.retryAt, now + (2 * 3600 + 3 * 60 + 4) * 1000);
    assert.match(error.message, /daily translation limit/);
    return true;
  });
});

test("MyMemory: error status without a quota flag cannot become a cached translation", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({
    responseStatus: 403, responseDetails: "Invalid request", responseData: { translatedText: "error" },
  }));
  const service = new TranslationService(0);
  await assert.rejects(translate(service, "Hello"), /Invalid request/);
  fetch.mock.mockImplementation(async () => success());
  const result = await translate(service, "Hello");
  assert.equal(result.result.text, "Привет");
  assert.equal(result.cached, false);
});

test("MyMemory: only an explicitly configured email is sent", async (t) => {
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    urls.push(new URL(url));
    return success();
  });
  await new MyMemoryProvider().translate("Hello", "auto", "ru", signal());
  await new MyMemoryProvider("reader@example.test").translate("Hello", "auto", "ru", signal());
  assert.equal(urls[0].searchParams.has("de"), false);
  assert.equal(urls[1].searchParams.get("de"), "reader@example.test");
  assert.equal(urls[1].searchParams.get("langpair"), "en|ru");
});

test("queued duplicates reuse a completed result across automatic and explicit directions", async (t) => {
  let finish;
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve; }));
  const service = new TranslationService(0);
  const first = translate(service, " Hello ");
  const second = translate(service, "Hello", { source: "en" });
  await nextTurn();
  assert.equal(fetch.mock.callCount(), 1);
  finish(success());
  assert.equal((await first).cached, false);
  assert.equal((await second).cached, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test("rate limits pause queued and new requests while cached results remain available", async (t) => {
  let time = now;
  t.mock.method(Date, "now", () => time);
  const fetch = t.mock.method(globalThis, "fetch", async () => success());
  const service = new TranslationService(0);
  await translate(service, "cached");
  fetch.mock.mockImplementation(async () => json({}, { status: 429, headers: { "Retry-After": "120" } }));
  await Promise.all([
    assert.rejects(translate(service, "first"), RateLimitError),
    assert.rejects(translate(service, "queued"), RateLimitError),
  ]);
  await assert.rejects(translate(service, "new"), RateLimitError);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal((await translate(service, "cached")).cached, true);
  assert.equal(fetch.mock.callCount(), 2);

  time += 120_001;
  fetch.mock.mockImplementation(async () => success());
  assert.equal((await translate(service, "first")).cached, false);
  assert.equal(fetch.mock.callCount(), 3);
});

test("changing provider credentials does not reuse a previous cooldown or cache", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, { status: 429 }));
  const service = new TranslationService(0);
  await assert.rejects(translate(service, "Hello"), RateLimitError);
  fetch.mock.mockImplementation(async () => success());
  assert.equal((await translate(service, "Hello", {
    settings: { ...DEFAULT_SETTINGS, myMemoryEmail: "reader@example.test" },
  })).cached, false);

  fetch.mock.mockImplementation(async () => json({ translatedText: "Здравствуйте" }));
  const libre = { ...DEFAULT_SETTINGS, provider: "libretranslate", libreTranslateUrl: "https://one.test" };
  await translate(service, "Hello", { settings: libre });
  const differentServer = await translate(service, "Hello", { settings: { ...libre, libreTranslateUrl: "https://two.test" } });
  assert.equal(differentServer.cached, false);
  assert.equal(fetch.mock.callCount(), 4);
});

test("cancelled queued requests never reach the provider or block later requests", async (t) => {
  let finish;
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve; }));
  const service = new TranslationService(0);
  const first = translate(service, "first");
  const controller = new AbortController();
  const cancelled = translate(service, "cancelled", { signal: controller.signal });
  const rejection = assert.rejects(cancelled, { name: "AbortError" });
  controller.abort();
  await rejection;
  await nextTurn();
  assert.equal(fetch.mock.callCount(), 1);
  fetch.mock.mockImplementation(async () => success());
  finish(success());
  await first;
  await translate(service, "last");
  assert.equal(fetch.mock.callCount(), 2);
});

test("requests to one provider are spaced apart", async (t) => {
  const starts = [];
  t.mock.method(globalThis, "fetch", async () => {
    starts.push(Date.now());
    return success();
  });
  const service = new TranslationService(30);
  await Promise.all([translate(service, "first"), translate(service, "second")]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] >= 29);
});

test("cancellation during spacing prevents a provider call", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => success());
  const service = new TranslationService(60_000);
  await translate(service, "first");
  const controller = new AbortController();
  const pending = translate(service, "second", { signal: controller.signal });
  const rejection = assert.rejects(pending, { name: "AbortError" });
  await nextTurn();
  controller.abort();
  await rejection;
  assert.equal(fetch.mock.callCount(), 1);
});

test("non-rate-limit HTTP errors retain useful status messages", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(new MyMemoryProvider().translate("Hello", "en", "ru", signal()), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.ok(!(error instanceof RateLimitError));
    assert.match(error.message, /HTTP 503/);
    return true;
  });
});

test("cooldowns survive a background restart without sending another request", async (t) => {
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, {
    status: 429, headers: { "Retry-After": "3600" },
  }));
  let stored;
  const first = new TranslationService(0, async (cooldowns) => { stored = structuredClone(cooldowns); });
  await assert.rejects(translate(first, "first"), RateLimitError);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].retryAt, now + 3_600_000);

  const restarted = new TranslationService(0);
  restarted.restoreCooldowns(stored);
  await assert.rejects(translate(restarted, "second"), RateLimitError);
  assert.equal(fetch.mock.callCount(), 1);
});

test("expired or invalid saved cooldowns do not prevent translation", async (t) => {
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async () => success());
  const service = new TranslationService(0);
  service.restoreCooldowns(null);
  service.restoreCooldowns([
    null, {}, { key: "invalid", retryAt: Infinity },
    { key: JSON.stringify(["mymemory", ""]), provider: "MyMemory", retryAt: now - 1, dailyLimit: false },
  ]);
  await translate(service, "Hello");
  assert.equal(fetch.mock.callCount(), 1);
});

test("a session storage failure does not hide a provider's cooldown", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, { status: 429 }));
  const service = new TranslationService(0, async () => { throw new Error("Storage unavailable"); });
  await assert.rejects(translate(service, "first"), RateLimitError);
  await assert.rejects(translate(service, "second"), RateLimitError);
  assert.equal(fetch.mock.callCount(), 1);
});
