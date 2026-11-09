import type { TranslationResult } from "../providers/types";
import type { TargetLanguage } from "../shared/types";
import type { SelectionSnapshot } from "./selection";
import popupCss from "./popup.css?inline";

interface PopupCallbacks {
  onClose: () => void;
  onRetry: () => void;
  onSwap: () => void;
}

const languageNames: Record<TargetLanguage, string> = { en: "English", ru: "Russian" };

export class TranslationPopup {
  private readonly host = document.createElement("div");
  private readonly shadow = this.host.attachShadow({ mode: "closed" });
  private readonly popup = document.createElement("div");
  private readonly languages = document.createElement("span");
  private readonly loading = document.createElement("div");
  private readonly translation = document.createElement("div");
  private readonly error = document.createElement("div");
  private readonly copyButton = document.createElement("button");
  private readonly copyStatus = document.createElement("span");
  private readonly retryButton = document.createElement("button");
  private translatedText = "";
  private destroyed = false;

  constructor(
    private readonly anchor: SelectionSnapshot,
    private readonly callbacks: PopupCallbacks,
  ) {
    this.host.style.cssText = "all:initial;position:fixed;inset:0 auto auto 0;width:0;height:0;z-index:2147483647;";
    const style = document.createElement("style");
    style.textContent = popupCss;
    this.shadow.append(style);

    this.popup.className = "popup";
    this.popup.setAttribute("role", "dialog");
    this.popup.setAttribute("aria-label", "Translation");
    const header = document.createElement("div");
    header.className = "header";
    this.languages.className = "languages";
    const closeButton = this.makeButton("×", "Close", "close");
    closeButton.addEventListener("click", this.callbacks.onClose);
    header.append(this.languages, closeButton);

    const body = document.createElement("div");
    body.className = "body";
    this.loading.className = "loading";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    const loadingText = document.createElement("span");
    loadingText.textContent = "Translating…";
    this.loading.append(spinner, loadingText);
    this.translation.className = "translation";
    this.error.className = "error";
    body.append(this.loading, this.translation, this.error);

    const footer = document.createElement("div");
    footer.className = "footer";
    this.copyStatus.className = "copy-status";
    this.copyStatus.setAttribute("aria-live", "polite");
    this.copyButton = this.makeButton("Copy", "Copy translation");
    this.copyButton.addEventListener("click", () => void this.copyTranslation());
    const swapButton = this.makeButton("Swap languages", "Swap languages");
    swapButton.addEventListener("click", this.callbacks.onSwap);
    this.retryButton = this.makeButton("Retry", "Retry translation");
    this.retryButton.addEventListener("click", this.callbacks.onRetry);
    footer.append(this.copyStatus, this.retryButton, this.copyButton, swapButton);
    this.popup.append(header, body, footer);
    this.shadow.append(this.popup);

    this.popup.addEventListener("mousedown", (event) => {
      if ((event.target as Element).closest("button")) event.preventDefault();
    });
    document.addEventListener("pointerdown", this.onOutsidePointerDown, true);
    document.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("scroll", this.reposition, true);
    window.addEventListener("resize", this.reposition);
    window.visualViewport?.addEventListener("resize", this.reposition);
    window.visualViewport?.addEventListener("scroll", this.reposition);
    (document.documentElement || document.body).append(this.host);
  }

  setLoading(source: TargetLanguage, target: TargetLanguage): void {
    this.languages.textContent = `${languageNames[source]} → ${languageNames[target]}`;
    this.loading.hidden = false;
    this.translation.hidden = true;
    this.error.hidden = true;
    this.retryButton.hidden = true;
    this.copyButton.hidden = true;
    this.copyStatus.textContent = "";
    this.reposition();
  }

  setResult(result: TranslationResult, source: TargetLanguage, target: TargetLanguage): void {
    this.translatedText = result.text;
    this.translation.textContent = result.text;
    this.languages.textContent = `${languageNames[source]} → ${languageNames[target]}`;
    this.loading.hidden = true;
    this.error.hidden = true;
    this.translation.hidden = false;
    this.retryButton.hidden = true;
    this.copyButton.hidden = false;
    this.reposition();
  }

  setError(message: string): void {
    this.error.textContent = message;
    this.loading.hidden = true;
    this.translation.hidden = true;
    this.error.hidden = false;
    this.retryButton.hidden = false;
    this.copyButton.hidden = true;
    this.reposition();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener("pointerdown", this.onOutsidePointerDown, true);
    document.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("scroll", this.reposition, true);
    window.removeEventListener("resize", this.reposition);
    window.visualViewport?.removeEventListener("resize", this.reposition);
    window.visualViewport?.removeEventListener("scroll", this.reposition);
    this.host.remove();
  }

  private makeButton(text: string, title: string, className = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.className = className;
    return button;
  }

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this.host)) this.callbacks.onClose();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.callbacks.onClose();
  };

  private readonly reposition = (): void => {
    if (this.destroyed) return;
    const rect = this.anchor.getRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = this.popup.offsetWidth;
    const height = this.popup.offsetHeight;
    const margin = 8;
    const desiredLeft = rect.right - Math.min(width / 2, 100);
    const left = Math.max(
      viewportLeft + margin,
      Math.min(desiredLeft, viewportLeft + viewportWidth - width - margin),
    );
    let top = rect.bottom + margin;
    if (top + height > viewportTop + viewportHeight - margin) {
      top = rect.top - height - margin;
    }
    top = Math.max(viewportTop + margin, Math.min(top, viewportTop + viewportHeight - height - margin));
    this.popup.style.left = `${Math.round(left)}px`;
    this.popup.style.top = `${Math.round(top)}px`;
  };

  private async copyTranslation(): Promise<void> {
    if (!this.translatedText) return;
    try {
      await navigator.clipboard.writeText(this.translatedText);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = this.translatedText;
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
      this.shadow.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        this.copyStatus.textContent = "Copy failed";
        return;
      }
    }
    this.copyStatus.textContent = "Copied";
  }
}
