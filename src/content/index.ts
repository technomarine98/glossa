import { DEFAULT_SETTINGS, detectLanguage, getSettings, isSiteDisabled } from "../shared/settings";
import type {
  Language,
  TargetLanguage,
  TranslateMessage,
  TranslationResponse,
  TranslationSettings,
} from "../shared/types";
import { TranslationPopup } from "./popup";
import { captureSelection, isCompletedKeyboardSelection, type SelectionSnapshot } from "./selection";

interface ActiveTranslation {
  id: string;
  popup: TranslationPopup;
  text: string;
  source: TargetLanguage;
  target: TargetLanguage;
  translatedText?: string;
}

let settings = DEFAULT_SETTINGS;
let selectionTimer: number | undefined;
let active: ActiveTranslation | undefined;

function directionFor(text: string): { source: Language; target: TargetLanguage } {
  switch (settings.defaultDirection) {
    case "en-ru":
      return { source: "en", target: "ru" };
    case "ru-en":
      return { source: "ru", target: "en" };
    case "auto":
      return { source: "auto", target: detectLanguage(text) === "ru" ? "en" : "ru" };
  }
}

function cancelRequest(id: string): void {
  void browser.runtime.sendMessage({ type: "cancel", requestId: id }).catch(() => undefined);
}

function clearSelectionTimer(): void {
  if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
  selectionTimer = undefined;
}

function closeActive(popup?: TranslationPopup): void {
  if (popup && active?.popup !== popup) {
    popup.destroy();
    return;
  }
  clearSelectionTimer();
  if (active) cancelRequest(active.id);
  active?.popup.destroy();
  active = undefined;
}

async function runTranslation(
  text: string,
  source: Language,
  target: TargetLanguage,
  popup: TranslationPopup,
): Promise<void> {
  if (active) cancelRequest(active.id);
  const id = crypto.randomUUID();
  const resolvedSource = source === "auto" ? detectLanguage(text) : source;
  active = { id, popup, text, source: resolvedSource, target };
  popup.setLoading(resolvedSource, target);

  try {
    const message: TranslateMessage = { type: "translate", requestId: id, text, source, target };
    const response = await browser.runtime.sendMessage(message) as TranslationResponse;
    if (active?.id !== id) return;
    if (response.ok) {
      active.source = response.source;
      active.translatedText = response.result.text;
      popup.setResult(response.result, response.source, response.target);
    } else if (!response.aborted) {
      popup.setError(response.error);
    }
  } catch (error) {
    if (active?.id !== id) return;
    popup.setError(error instanceof Error ? error.message : "Could not contact the translation service.");
  }
}

function startTranslation(snapshot: SelectionSnapshot): void {
  const { source, target } = directionFor(snapshot.text);
  const popup = new TranslationPopup(snapshot, {
    onClose: () => closeActive(popup),
    onRetry: () => {
      if (active?.popup === popup) void runTranslation(active.text, active.source, active.target, popup);
    },
    onSwap: () => {
      if (active?.popup !== popup || !active.translatedText) return;
      const text = active.translatedText;
      const source = active.target;
      const target = active.source;
      void runTranslation(text, source, target, popup);
    },
  });
  void runTranslation(snapshot.text, source, target, popup);
}

function canTranslate(): boolean {
  return settings.enabled
    && settings.autoTranslate
    && !isSiteDisabled(settings, window.location.hostname);
}

function scheduleTranslation(event: MouseEvent | KeyboardEvent): void {
  if (!canTranslate()) {
    closeActive();
    return;
  }
  const releasedRequiredModifier = event instanceof KeyboardEvent && event.key === settings.modifierKey;
  if (settings.requireModifier && !releasedRequiredModifier && !event.getModifierState(settings.modifierKey)) return;
  if (event instanceof KeyboardEvent && !isCompletedKeyboardSelection(event)) return;
  const snapshot = captureSelection(event.target);
  if (!snapshot) return;
  closeActive();
  selectionTimer = window.setTimeout(() => {
    selectionTimer = undefined;
    if (canTranslate()) startTranslation(snapshot);
  }, Math.max(0, settings.translationDelay));
}

document.addEventListener("mouseup", scheduleTranslation, true);
document.addEventListener("keyup", scheduleTranslation, true);
document.addEventListener("pointerdown", clearSelectionTimer, true);

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<TranslationSettings>) };
  if (!canTranslate()) closeActive();
});

void getSettings().then((loaded) => {
  settings = loaded;
  if (!canTranslate()) closeActive();
});
