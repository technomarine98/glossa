import { getSettings, isSiteDisabled } from "../shared/settings";
import type {
  BackgroundMessage,
  TranslateMessage,
  TranslationResponse,
} from "../shared/types";
import { TranslationCache } from "./cache";
import { translateText } from "./translator";

const cache = new TranslationCache();
const currentRequests = new Map<number, { requestId: string; controller: AbortController }>();

function cacheKey(message: TranslateMessage, provider: string): string {
  return JSON.stringify([provider, message.text, message.source, message.target]);
}

async function handleTranslation(
  message: TranslateMessage,
  tabId: number,
  senderUrl?: string,
): Promise<TranslationResponse> {
  const settings = await getSettings();
  if (!settings.enabled || (senderUrl && isSiteDisabled(settings, new URL(senderUrl).hostname))) {
    return { ok: false, requestId: message.requestId, error: "Translation is disabled on this page." };
  }

  const text = message.text.trim();
  if (!text || text.length > 5000) {
    return {
      ok: false,
      requestId: message.requestId,
      error: text ? "Select up to 5,000 characters at a time." : "No text was selected.",
    };
  }

  currentRequests.get(tabId)?.controller.abort();
  const controller = new AbortController();
  currentRequests.set(tabId, { requestId: message.requestId, controller });

  const key = cacheKey(message, settings.provider);
  const cached = cache.get(key);
  if (cached) {
    currentRequests.delete(tabId);
    return {
      ok: true,
      requestId: message.requestId,
      result: cached,
      source: cached.detectedLanguage === "ru" ? "ru" : "en",
      target: message.target,
      cached: true,
    };
  }

  try {
    const result = await translateText(text, message.source, message.target, settings, controller.signal);
    cache.set(key, result);
    return {
      ok: true,
      requestId: message.requestId,
      result,
      source: result.detectedLanguage === "ru" ? "ru" : "en",
      target: message.target,
      cached: false,
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      requestId: message.requestId,
      error: aborted
        ? "Translation cancelled."
        : error instanceof Error
          ? error.message
          : "The translation request failed.",
      aborted,
    };
  } finally {
    if (currentRequests.get(tabId)?.requestId === message.requestId) {
      currentRequests.delete(tabId);
    }
  }
}

browser.runtime.onMessage.addListener((value, sender) => {
  const message = value as BackgroundMessage;
  if (!message || typeof message !== "object") return undefined;

  const tabId = sender.tab?.id ?? -1;
  if (message.type === "cancel") {
    const current = currentRequests.get(tabId);
    if (current?.requestId === message.requestId) {
      current.controller.abort();
      currentRequests.delete(tabId);
    }
    return Promise.resolve();
  }
  if (message.type === "translate") {
    return handleTranslation(message, tabId, sender.url);
  }
  return undefined;
});
