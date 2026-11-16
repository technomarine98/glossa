import { getSettings, isSiteDisabled } from "../shared/settings";
import type {
  BackgroundMessage,
  TranslateMessage,
  TranslationResponse,
} from "../shared/types";
import { RateLimitError } from "../providers/types";
import { TranslationService } from "./translator";

let cooldownSave = Promise.resolve();
const translator = new TranslationService(750, (cooldowns) => {
  cooldownSave = cooldownSave.catch(() => undefined)
    .then(() => browser.storage.session.set({ translationCooldowns: cooldowns }));
  return cooldownSave;
});
const cooldownsReady = browser.storage.session.get("translationCooldowns")
  .then((stored) => translator.restoreCooldowns(stored.translationCooldowns))
  .catch(() => undefined);
const currentRequests = new Map<string, { requestId: string; controller: AbortController }>();

async function handleTranslation(
  message: TranslateMessage,
  requestOwner: string,
  senderUrl?: string,
): Promise<TranslationResponse> {
  currentRequests.get(requestOwner)?.controller.abort();
  const controller = new AbortController();
  currentRequests.set(requestOwner, { requestId: message.requestId, controller });

  try {
    const settings = await getSettings();
    await cooldownsReady;
    controller.signal.throwIfAborted();
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

    const { result, cached } = await translator.translate(text, message.source, message.target, settings, controller.signal);
    return {
      ok: true,
      requestId: message.requestId,
      result,
      source: result.detectedLanguage === "ru" ? "ru" : "en",
      target: message.target,
      cached,
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
      retryAt: error instanceof RateLimitError ? error.retryAt : undefined,
    };
  } finally {
    if (currentRequests.get(requestOwner)?.controller === controller) {
      currentRequests.delete(requestOwner);
    }
  }
}

browser.runtime.onMessage.addListener((value, sender) => {
  const message = value as BackgroundMessage;
  if (!message || typeof message !== "object") return undefined;

  const requestOwner = `${sender.tab?.id ?? -1}:${sender.frameId ?? 0}`;
  if (message.type === "cancel") {
    const current = currentRequests.get(requestOwner);
    if (current?.requestId === message.requestId) {
      current.controller.abort();
      currentRequests.delete(requestOwner);
    }
    return Promise.resolve();
  }
  if (message.type === "translate") {
    return handleTranslation(message, requestOwner, sender.url);
  }
  return undefined;
});
