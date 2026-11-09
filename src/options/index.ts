import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../shared/settings";
import type { TranslationSettings } from "../shared/types";

const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const provider = document.querySelector<HTMLSelectElement>("#provider")!;
const requireModifier = document.querySelector<HTMLInputElement>("#requireModifier")!;
const libreUrl = document.querySelector<HTMLInputElement>("#libreTranslateUrl")!;
const libreKey = document.querySelector<HTMLInputElement>("#libreTranslateApiKey")!;
const googleKey = document.querySelector<HTMLInputElement>("#googleApiKey")!;

function checkbox(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

function input(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

function select(id: string): HTMLSelectElement {
  return document.querySelector<HTMLSelectElement>(`#${id}`)!;
}

function updateVisibility(): void {
  document.querySelector<HTMLElement>("#libre-settings")!.hidden = provider.value !== "libretranslate";
  document.querySelector<HTMLElement>("#google-settings")!.hidden = provider.value !== "google";
  document.querySelector<HTMLElement>("#mymemory-hint")!.hidden = provider.value !== "mymemory";
  document.querySelector<HTMLElement>("#modifier-row")!.hidden = !requireModifier.checked;
  libreUrl.required = provider.value === "libretranslate";
  googleKey.required = provider.value === "google";
}

function fillForm(settings: TranslationSettings): void {
  checkbox("enabled").checked = settings.enabled;
  checkbox("autoTranslate").checked = settings.autoTranslate;
  select("defaultDirection").value = settings.defaultDirection;
  input("translationDelay").value = String(settings.translationDelay);
  requireModifier.checked = settings.requireModifier;
  select("modifierKey").value = settings.modifierKey;
  provider.value = settings.provider;
  libreUrl.value = settings.libreTranslateUrl;
  libreKey.value = settings.libreTranslateApiKey;
  googleKey.value = settings.googleApiKey;
  document.querySelector<HTMLTextAreaElement>("#disabledSites")!.value = settings.disabledSites.join("\n");
  updateVisibility();
}

function readForm(): TranslationSettings {
  return {
    enabled: checkbox("enabled").checked,
    autoTranslate: checkbox("autoTranslate").checked,
    provider: provider.value as TranslationSettings["provider"],
    defaultDirection: select("defaultDirection").value as TranslationSettings["defaultDirection"],
    translationDelay: Math.min(2000, Math.max(0, Number(input("translationDelay").value))),
    requireModifier: requireModifier.checked,
    modifierKey: select("modifierKey").value as TranslationSettings["modifierKey"],
    disabledSites: document.querySelector<HTMLTextAreaElement>("#disabledSites")!.value
      .split(/\s+/)
      .map((site) => site.trim().toLowerCase())
      .filter(Boolean),
    libreTranslateUrl: libreUrl.value.trim(),
    libreTranslateApiKey: libreKey.value.trim(),
    googleApiKey: googleKey.value.trim(),
  };
}

async function requestLibrePermission(settings: TranslationSettings): Promise<boolean> {
  if (settings.provider !== "libretranslate") return true;
  const url = new URL(settings.libreTranslateUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LibreTranslate must use an HTTP or HTTPS URL.");
  }
  return browser.permissions.request({ origins: [`${url.origin}/*`] });
}

provider.addEventListener("change", updateVisibility);
requireModifier.addEventListener("change", updateVisibility);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      status.textContent = "Saving…";
      const settings = readForm();
      const permitted = await requestLibrePermission(settings);
      if (!permitted) {
        status.textContent = "Server permission is required for LibreTranslate.";
        return;
      }
      await saveSettings(settings);
      status.textContent = "Settings saved.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Could not save settings.";
    }
  })();
});

document.querySelector("#reset")!.addEventListener("click", () => {
  fillForm(DEFAULT_SETTINGS);
  status.textContent = "Defaults restored. Save to apply them.";
});

void getSettings().then((settings) => fillForm(settings)).catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : "Could not load settings.";
});
