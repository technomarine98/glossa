import { GoogleProvider } from "../providers/google";
import { LibreTranslateProvider } from "../providers/libretranslate";
import { MyMemoryProvider } from "../providers/mymemory";
import { RateLimitError, type TranslationProvider, type TranslationResult } from "../providers/types";
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
  }
}

interface ProviderState {
  tail: Promise<void>;
  lastStarted: number;
  cooldown?: RateLimitError;
}

export interface SavedCooldown {
  key: string;
  provider: string;
  retryAt: number;
  dailyLimit: boolean;
}

function providerKey(settings: TranslationSettings): string {
  switch (settings.provider) {
    case "google": return JSON.stringify([settings.provider, settings.googleApiKey]);
    case "libretranslate": return JSON.stringify([settings.provider, settings.libreTranslateUrl, settings.libreTranslateApiKey]);
    case "mymemory": return JSON.stringify([settings.provider, settings.myMemoryEmail]);
  }
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
        cooldown: new RateLimitError(entry.provider, entry.retryAt, entry.dailyLimit),
      });
    }
  }

  private activeCooldowns(): SavedCooldown[] {
    return [...this.providers].flatMap(([key, state]) => {
      const cooldown = state.cooldown;
      return cooldown && cooldown.retryAt > Date.now()
        ? [{ key, provider: cooldown.provider, retryAt: cooldown.retryAt, dailyLimit: cooldown.dailyLimit }]
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
        throw new RateLimitError(cooldown.provider, cooldown.retryAt, cooldown.dailyLimit);
      }
      const delay = providerState.lastStarted + this.minIntervalMs - Date.now();
      if (delay > 0) await wait(delay, signal);
      signal.throwIfAborted();
      providerState.lastStarted = Date.now();
      try {
        const result = await translateText(normalizedText, resolvedSource, target, settings, signal);
        this.cache.set(key, result);
        providerState.cooldown = undefined;
        return { result, cached: false };
      } catch (error) {
        if (error instanceof RateLimitError) {
          providerState.cooldown = error;
          // Preserve the rate limit error even if session storage is unavailable.
          await this.saveCooldowns?.(this.activeCooldowns()).catch(() => undefined);
        }
        throw error;
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
