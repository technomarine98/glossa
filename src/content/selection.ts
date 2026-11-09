export interface SelectionSnapshot {
  text: string;
  getRect: () => DOMRect;
}

function isSensitiveField(element: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (element instanceof HTMLInputElement && ["password", "hidden", "file"].includes(element.type)) {
    return true;
  }
  const autocomplete = element.autocomplete.toLowerCase();
  return autocomplete.includes("password") || autocomplete.includes("cc-") || autocomplete === "one-time-code";
}

function inputSelection(element: HTMLInputElement | HTMLTextAreaElement): SelectionSnapshot | undefined {
  if (isSensitiveField(element) || element.closest("[data-zen-translate-ignore]")) return undefined;
  const start = element.selectionStart;
  const end = element.selectionEnd;
  if (start === null || end === null || start === end) return undefined;
  const text = element.value.slice(start, end).trim();
  if (!text) return undefined;
  return { text, getRect: () => element.getBoundingClientRect() };
}

export function captureSelection(target: EventTarget | null): SelectionSnapshot | undefined {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return inputSelection(target);
  }

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const text = selection.toString().trim();
  if (!text) return undefined;
  const range = selection.getRangeAt(0).cloneRange();
  if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.commonAncestorContainer as Element;
    if (element.closest("[data-zen-translate-ignore]")) return undefined;
  }

  return {
    text,
    getRect: () => {
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
      const fallback = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as Element
        : range.startContainer.parentElement;
      return fallback?.getBoundingClientRect() ?? rect;
    },
  };
}

export function isCompletedKeyboardSelection(event: KeyboardEvent): boolean {
  const navigationKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
  return event.key === "Shift" || (!event.shiftKey && navigationKeys.includes(event.key));
}
