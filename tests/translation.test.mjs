import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { build } from "vite";
import { readFile } from "node:fs/promises";

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
  TranslationService, DEFAULT_SETTINGS: APP_DEFAULT_SETTINGS, MyMemoryProvider, GoogleProvider,
  LibreTranslateProvider, LingvaProvider, RateLimitError, ProviderError, ProviderUnavailableError, FallbackError, rateLimitError,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

const DEFAULT_SETTINGS = { ...APP_DEFAULT_SETTINGS, fallbackEnabled: false };

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
  ["Lingva", () => new LingvaProvider("https://example.test")],
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

const withBackups = {
  ...DEFAULT_SETTINGS,
  fallbackEnabled: true,
  fallbackLingvaUrls: ["https://lingva.example.test"],
  fallbackLibreTranslateUrls: ["https://libre.example.test"],
};

test("Lingva encodes selected text as one path segment and uses its public API", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requested = { url: new URL(url), options };
    return json({ translation: "Привет / мир?", info: { detectedSource: "en" } });
  });
  const result = await new LingvaProvider("https://lingva.example.test/base/")
    .translate("Hello / world? #&%", "auto", "ru", signal());
  assert.equal(result.text, "Привет / мир?");
  assert.equal(result.detectedLanguage, "en");
  assert.equal(requested.url.pathname, "/base/api/v1/auto/ru/Hello%20%2F%20world%3F%20%23%26%25");
  assert.equal(requested.url.search, "");
  assert.equal(requested.options.credentials, "omit");
});

test("a primary quota limit automatically switches to Lingva and skips its cooldown next time", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new URL(url).hostname === "api.mymemory.translated.net"
      ? json({}, { status: 429, headers: { "Retry-After": "3600" } })
      : json({ translation: "Запасной перевод" });
  });
  const service = new TranslationService(0);
  const settings = { ...withBackups, myMemoryEmail: "private@example.test", googleApiKey: "private-key", libreTranslateApiKey: "private-libre-key" };
  const first = await translate(service, "Hello", { settings });
  assert.equal(first.result.provider, "Lingva");
  assert.equal(first.result.fallback, true);
  assert.equal(first.cached, false);
  assert.equal((await translate(service, "Hello", { settings })).cached, true);
  await translate(service, "New selection", { settings });
  assert.deepEqual(calls.map((call) => call.url.hostname), ["api.mymemory.translated.net", "lingva.example.test", "lingva.example.test"]);
  for (const call of calls.slice(1)) {
    assert.doesNotMatch(call.url.href, /private/);
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.headers, undefined);
  }
});

test("a blocked Lingva backup falls through to keyless LibreTranslate", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const host = new URL(url).hostname;
    calls.push({ host, options });
    if (host === "api.mymemory.translated.net") return json({}, { status: 503 });
    if (host === "lingva.example.test") return new Response("Blocked", { status: 403 });
    return json({ translatedText: "Резервный перевод", detectedLanguage: { language: "en" } });
  });
  const response = await translate(new TranslationService(0), "Hello", {
    settings: { ...withBackups, libreTranslateApiKey: "must-not-leak" },
  });
  assert.equal(response.result.provider, "LibreTranslate");
  assert.equal(response.result.fallback, true);
  assert.deepEqual(calls.map((call) => call.host), ["api.mymemory.translated.net", "lingva.example.test", "libre.example.test"]);
  const body = JSON.parse(calls[2].options.body);
  assert.equal(body.api_key, undefined);
  assert.equal(body.q, "Hello");
  assert.equal(body.source, "en");
  assert.equal(body.target, "ru");
});

test("automatic switching can be disabled", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, { status: 429 }));
  await assert.rejects(translate(new TranslationService(0), "Hello", {
    settings: { ...withBackups, fallbackEnabled: false },
  }), RateLimitError);
  assert.equal(fetch.mock.callCount(), 1);
});

test("empty backup lists preserve the main provider's error without extra requests", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => json({}, { status: 429 }));
  await assert.rejects(translate(new TranslationService(0), "Hello", {
    settings: { ...withBackups, fallbackLingvaUrls: [], fallbackLibreTranslateUrls: [] },
  }), RateLimitError);
  assert.equal(fetch.mock.callCount(), 1);
});

test("primary success never contacts a backup and reports the actual provider", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => success());
  const response = await translate(new TranslationService(0), "Hello", { settings: withBackups });
  assert.equal(response.result.provider, "MyMemory");
  assert.equal(response.result.fallback, false);
  assert.equal(fetch.mock.callCount(), 1);
});

test("unavailable backups get separate persistent cooldowns and report the earliest retry", async (t) => {
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async (url) => new URL(url).hostname === "api.mymemory.translated.net"
    ? json({}, { status: 429, headers: { "Retry-After": "3600" } })
    : new Response("Unavailable", { status: 503 }));
  let stored;
  const service = new TranslationService(0, async (cooldowns) => { stored = structuredClone(cooldowns); });
  await assert.rejects(translate(service, "first", { settings: withBackups }), (error) => {
    assert.ok(error instanceof FallbackError);
    assert.equal(error.retryAt, now + 30_000);
    assert.match(error.message, /backup services are unavailable/);
    return true;
  });
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal(stored.length, 3);
  assert.equal(stored.filter((entry) => entry.kind === "unavailable").length, 2);
  const restarted = new TranslationService(0);
  restarted.restoreCooldowns(stored);
  await assert.rejects(translate(restarted, "next", { settings: withBackups }), FallbackError);
  assert.equal(fetch.mock.callCount(), 3);
});

test("network errors and timeouts switch to a backup", async (t) => {
  for (const mode of ["network", "timeout"]) {
    const fetch = t.mock.method(globalThis, "fetch", async (url) => {
      if (new URL(url).hostname !== "api.mymemory.translated.net") return json({ translation: "Привет" });
      if (mode === "network") throw new TypeError("Network error");
      return new Promise(() => {});
    });
    const response = await translate(new TranslationService(0, undefined, 10), mode, { settings: withBackups });
    assert.equal(response.result.provider, "Lingva");
    assert.equal(fetch.mock.callCount(), 2);
    fetch.mock.restore();
  }
});

test("user cancellation never triggers fallback requests", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const controller = new AbortController();
  const response = translate(new TranslationService(0), "Hello", { settings: withBackups, signal: controller.signal });
  const rejection = assert.rejects(response, { name: "AbortError" });
  await nextTurn();
  controller.abort();
  await rejection;
  assert.equal(fetch.mock.callCount(), 1);
});

test("duplicate endpoints are not retried with different credentials", async (t) => {
  const hosts = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    hosts.push(new URL(url).hostname);
    return json({}, { status: 429 });
  });
  await assert.rejects(translate(new TranslationService(0), "Hello", {
    settings: {
      ...withBackups, provider: "libretranslate", libreTranslateUrl: "https://libre.example.test/",
      libreTranslateApiKey: "private-key", fallbackLingvaUrls: ["https://lingva.example.test", "https://lingva.example.test/"],
    },
  }), FallbackError);
  assert.deepEqual(hosts, ["libre.example.test", "lingva.example.test"]);
});

test("the main provider is tried again after a temporary failure expires", async (t) => {
  let time = now;
  t.mock.method(Date, "now", () => time);
  const fetch = t.mock.method(globalThis, "fetch", async (url) => new URL(url).hostname === "api.mymemory.translated.net"
    ? json({}, { status: 503 }) : json({ translation: "Резерв" }));
  const service = new TranslationService(0);
  await translate(service, "first", { settings: withBackups });
  time += 30_001;
  fetch.mock.mockImplementation(async () => success());
  const response = await translate(service, "second", { settings: withBackups });
  assert.equal(response.result.provider, "MyMemory");
  assert.equal(response.result.fallback, false);
});

test("configuration errors do not send text to backup servers", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => success());
  await assert.rejects(translate(new TranslationService(0), "Hello", {
    settings: { ...withBackups, provider: "google", googleApiKey: "" },
  }), /Add a Google Cloud API key/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("backup endpoint failures do not overwrite cached results from other endpoints", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url) => new URL(url).hostname === "api.mymemory.translated.net"
    ? json({}, { status: 429 }) : json({ translation: "Резерв" }));
  const service = new TranslationService(0);
  const [first, second] = await Promise.all([
    translate(service, "Hello", { settings: withBackups }),
    translate(service, "Hello", { settings: withBackups }),
  ]);
  assert.equal(first.result.provider, "Lingva");
  assert.equal(second.result.provider, "Lingva");
  assert.equal(second.cached, true);
  assert.equal(fetch.mock.callCount(), 2);
});

test("package, lockfile, and browser manifest versions match", async () => {
  const [pkg, lock, manifest] = await Promise.all(["package.json", "package-lock.json", "public/manifest.json"]
    .map(async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))));
  assert.equal(pkg.version, "1.1.0");
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[""].version, pkg.version);
  for (const server of [APP_DEFAULT_SETTINGS.lingvaUrl, ...APP_DEFAULT_SETTINGS.fallbackLingvaUrls, ...APP_DEFAULT_SETTINGS.fallbackLibreTranslateUrls]) {
    assert.ok(manifest.host_permissions.includes(`${new URL(server).origin}/*`));
  }
});
