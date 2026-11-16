import { GoogleProvider } from "../providers/google";
import { LibreTranslateProvider } from "../providers/libretranslate";
import { LingvaProvider } from "../providers/lingva";
import { MyMemoryProvider } from "../providers/mymemory";
import { FallbackError, ProviderError, ProviderUnavailableError, RateLimitError, type TranslationProvider, type TranslationResult } from "../providers/types";
import { detectLanguage } from "../shared/settings";
import type { Language, TargetLanguage, TranslationSettings } from "../shared/types";
import { TranslationCache } from "./cache";

function createProvider(settings: TranslationSettings): TranslationProvider {
  switch (settings.provider) {
    case "google":
      return new GoogleProvider(settings.googleApiKey);
    case "libretranslate":
      return new LibreTranslateProvider(settings.libreTranslateUrl, settings.libreTranslateApiKey);
    case "mymemory":
      return new MyMemoryProvider(settings.myMemoryEmail);
    case "lingva":
      return new LingvaProvider(settings.lingvaUrl);
  }
}

interface ProviderState {
  tail: Promise<void>;
  lastStarted: number;
  cooldown?: RateLimitError | ProviderUnavailableError;
}

export interface SavedCooldown {
  key: string;
  provider: string;
  retryAt: number;
  dailyLimit: boolean;
  kind?: "rate-limit" | "unavailable";
  detail?: string;
}

function providerKey(settings: TranslationSettings): string {
  switch (settings.provider) {
    case "google": return JSON.stringify([settings.provider, settings.googleApiKey]);
    case "libretranslate": return JSON.stringify([settings.provider, settings.libreTranslateUrl, settings.libreTranslateApiKey]);
    case "mymemory": return JSON.stringify([settings.provider, settings.myMemoryEmail]);
    case "lingva": return JSON.stringify([settings.provider, settings.lingvaUrl]);
  }
}

function providerName(settings: TranslationSettings): string {
  switch (settings.provider) {
    case "mymemory": return "MyMemory";
    case "google": return "Google Cloud";
    case "libretranslate": return "LibreTranslate";
    case "lingva": return "Lingva";
  }
}

function endpointKey(settings: TranslationSettings): string {
  const url = settings.provider === "lingva" ? settings.lingvaUrl
    : settings.provider === "libretranslate" ? settings.libreTranslateUrl : "";
  return JSON.stringify([settings.provider, url.trim().replace(/\/+$/, "")]);
}

function fallbackSettings(settings: TranslationSettings): TranslationSettings[] {
  if (!settings.fallbackEnabled) return [];
  return [
    ...settings.fallbackLingvaUrls.slice(0, 2).map((lingvaUrl) => ({ ...settings, provider: "lingva" as const, lingvaUrl })),
    ...settings.fallbackLibreTranslateUrls.slice(0, 2).map((libreTranslateUrl) => ({
      ...settings, provider: "libretranslate" as const, libreTranslateUrl, libreTranslateApiKey: "",
    })),
  ];
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class TranslationService {
  private readonly cache = new TranslationCache();
  private readonly providers = new Map<string, ProviderState>();

  constructor(
    private readonly minIntervalMs = 750,
    private readonly saveCooldowns?: (cooldowns: SavedCooldown[]) => Promise<void>,
    private readonly requestTimeoutMs = 8000,
  ) {}

  restoreCooldowns(entries: unknown): void {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (!entry || typeof entry.key !== "string" || typeof entry.provider !== "string"
        || typeof entry.retryAt !== "number" || !Number.isFinite(entry.retryAt)
        || entry.retryAt <= Date.now() || typeof entry.dailyLimit !== "boolean") continue;
      this.providers.set(entry.key, {
        tail: Promise.resolve(),
        lastStarted: 0,
        cooldown: entry.kind === "unavailable"
          ? new ProviderUnavailableError(entry.provider, entry.retryAt, typeof entry.detail === "string" ? entry.detail : `${entry.provider} is temporarily unavailable.`)
          : new RateLimitError(entry.provider, entry.retryAt, entry.dailyLimit),
      });
    }
  }

  private activeCooldowns(): SavedCooldown[] {
    return [...this.providers].flatMap(([key, state]) => {
      const cooldown = state.cooldown;
      return cooldown && cooldown.retryAt > Date.now()
        ? [{
          key, provider: cooldown.provider, retryAt: cooldown.retryAt,
          dailyLimit: cooldown instanceof RateLimitError && cooldown.dailyLimit,
          kind: cooldown instanceof RateLimitError ? "rate-limit" as const : "unavailable" as const,
          detail: cooldown.message,
        }]
        : [];
    });
  }

  async translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    settings: TranslationSettings,
    signal: AbortSignal,
  ): Promise<{ result: TranslationResult; cached: boolean }> {
    const attempted = new Set<string>();
    const errors: Array<RateLimitError | ProviderUnavailableError> = [];
    const candidates = [settings, ...fallbackSettings(settings)];
    for (const [index, candidate] of candidates.entries()) {
      signal.throwIfAborted();
      const endpoint = endpointKey(candidate);
      if (attempted.has(endpoint)) continue;
      attempted.add(endpoint);
      const fallback = index > 0;
      try {
        const response = await this.translateProvider(text, source, target, candidate, signal, fallback);
        return { ...response, result: { ...response.result, provider: providerName(candidate), fallback } };
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof RateLimitError || error instanceof ProviderUnavailableError)) throw error;
        if (!settings.fallbackEnabled) throw error;
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    throw new FallbackError(
      Math.min(...errors.map((error) => error.retryAt)),
      [...new Set(errors.map((error) => `${error.provider}: ${error instanceof RateLimitError ? "usage limit reached." : "temporarily unavailable."}`))],
    );
  }

  private async translateProvider(
    text: string,
    source: Language,
    target: TargetLanguage,
    settings: TranslationSettings,
    signal: AbortSignal,
    fallback: boolean,
  ): Promise<{ result: TranslationResult; cached: boolean }> {
    signal.throwIfAborted();
    const normalizedText = text.trim();
    const resolvedSource = source === "auto" ? detectLanguage(normalizedText) : source;
    const provider = providerKey(settings);
    const key = JSON.stringify([provider, normalizedText, resolvedSource, target]);
    const cached = this.cache.get(key);
    if (cached) return { result: cached, cached: true };

    let state = this.providers.get(provider);
    if (!state) {
      state = { tail: Promise.resolve(), lastStarted: 0 };
      this.providers.set(provider, state);
    }
    const providerState = state;
    const task = providerState.tail.then(async () => {
      signal.throwIfAborted();
      // Another tab may have completed the same translation while this one waited.
      const cached = this.cache.get(key);
      if (cached) return { result: cached, cached: true };
      const cooldown = providerState.cooldown;
      if (cooldown && cooldown.retryAt > Date.now()) {
        throw cooldown;
      }
      const delay = providerState.lastStarted + this.minIntervalMs - Date.now();
      if (delay > 0) await wait(delay, signal);
      signal.throwIfAborted();
      providerState.lastStarted = Date.now();
      const timeout = new AbortController();
      const attemptSignal = AbortSignal.any([signal, timeout.signal]);
      const timer = setTimeout(() => timeout.abort(new DOMException("Translation service timed out.", "TimeoutError")),
        fallback ? Math.min(4000, this.requestTimeoutMs) : this.requestTimeoutMs);
      try {
        const result = await abortable(translateText(normalizedText, resolvedSource, target, settings, attemptSignal), attemptSignal);
        this.cache.set(key, result);
        providerState.cooldown = undefined;
        return { result, cached: false };
      } catch (error) {
        signal.throwIfAborted();
        const retryable = error instanceof RateLimitError || error instanceof TypeError
          || timeout.signal.aborted || (error instanceof ProviderError && (error.retryable || fallback));
        if (retryable) {
          const unavailable = error instanceof RateLimitError ? error : new ProviderUnavailableError(
            providerName(settings), Date.now() + 30_000,
            error instanceof Error ? error.message : "Translation service is temporarily unavailable.",
          );
          providerState.cooldown = unavailable;
          // Preserve the rate limit error even if session storage is unavailable.
          await this.saveCooldowns?.(this.activeCooldowns()).catch(() => undefined);
          throw unavailable;
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
    providerState.tail = task.then(() => undefined, () => undefined);
    return abortable(task, signal);
  }
}

export async function translateText(
  text: string,
  source: Language,
  target: TargetLanguage,
  settings: TranslationSettings,
  signal: AbortSignal,
): Promise<TranslationResult> {
  const resolvedSource = source === "auto" ? detectLanguage(text) : source;
  const result = await createProvider(settings).translate(text, source, target, signal);
  return {
    ...result,
    detectedLanguage: result.detectedLanguage === "en" || result.detectedLanguage === "ru"
      ? result.detectedLanguage
      : resolvedSource,
  };
}
