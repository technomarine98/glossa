import { DEFAULT_SETTINGS, getSettings, saveSettings } from "../shared/settings";
import type { TranslationSettings } from "../shared/types";

const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const status = document.querySelector<HTMLSpanElement>("#status")!;
const provider = document.querySelector<HTMLSelectElement>("#provider")!;
const requireModifier = document.querySelector<HTMLInputElement>("#requireModifier")!;
const libreUrl = document.querySelector<HTMLInputElement>("#libreTranslateUrl")!;
const libreKey = document.querySelector<HTMLInputElement>("#libreTranslateApiKey")!;
const googleKey = document.querySelector<HTMLInputElement>("#googleApiKey")!;
const myMemoryEmail = document.querySelector<HTMLInputElement>("#myMemoryEmail")!;
const lingvaUrl = document.querySelector<HTMLInputElement>("#lingvaUrl")!;

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
  document.querySelector<HTMLElement>("#mymemory-settings")!.hidden = provider.value !== "mymemory";
  myMemoryEmail.disabled = provider.value !== "mymemory";
  document.querySelector<HTMLElement>("#modifier-row")!.hidden = !requireModifier.checked;
  libreUrl.required = provider.value === "libretranslate";
  libreUrl.disabled = provider.value !== "libretranslate";
  googleKey.required = provider.value === "google";
  document.querySelector<HTMLElement>("#lingva-settings")!.hidden = provider.value !== "lingva";
  document.querySelector<HTMLElement>("#fallback-settings")!.hidden = !checkbox("fallbackEnabled").checked;
  lingvaUrl.required = provider.value === "lingva";
  lingvaUrl.disabled = provider.value !== "lingva";
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
  myMemoryEmail.value = settings.myMemoryEmail;
  lingvaUrl.value = settings.lingvaUrl;
  checkbox("fallbackEnabled").checked = settings.fallbackEnabled;
  document.querySelector<HTMLTextAreaElement>("#fallbackLingvaUrls")!.value = settings.fallbackLingvaUrls.join("\n");
  document.querySelector<HTMLTextAreaElement>("#fallbackLibreTranslateUrls")!.value = settings.fallbackLibreTranslateUrls.join("\n");
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
    myMemoryEmail: myMemoryEmail.value.trim(),
    libreTranslateUrl: libreUrl.value.trim(),
    libreTranslateApiKey: libreKey.value.trim(),
    googleApiKey: googleKey.value.trim(),
    lingvaUrl: lingvaUrl.value.trim(),
    fallbackEnabled: checkbox("fallbackEnabled").checked,
    fallbackLingvaUrls: readServerUrls("fallbackLingvaUrls"),
    fallbackLibreTranslateUrls: readServerUrls("fallbackLibreTranslateUrls"),
  };
}

function serverUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Server addresses must be HTTP or HTTPS URLs without credentials, query parameters, or fragments.");
  }
  return url;
}

function readServerUrls(id: string): string[] {
  const lines = document.querySelector<HTMLTextAreaElement>(`#${id}`)!.value.split(/\s+/).filter(Boolean);
  // Turning off automatic switching must work even if an edited backup URL is invalid.
  if (!checkbox("fallbackEnabled").checked) return [...new Set(lines)];
  if (lines.length > 2) throw new Error("Enter at most two backup servers for each service.");
  return [...new Set(lines.map((line) => serverUrl(line).href.replace(/\/$/, "")))];
}

async function requestProviderPermissions(settings: TranslationSettings): Promise<boolean> {
  const servers = settings.provider === "libretranslate" ? [settings.libreTranslateUrl]
    : settings.provider === "lingva" ? [settings.lingvaUrl] : [];
  if (settings.fallbackEnabled) servers.push(...settings.fallbackLingvaUrls, ...settings.fallbackLibreTranslateUrls);
  const origins = [...new Set(servers.map((server) => `${serverUrl(server).origin}/*`))];
  return origins.length === 0 || browser.permissions.request({ origins });
}

provider.addEventListener("change", updateVisibility);
requireModifier.addEventListener("change", updateVisibility);
checkbox("fallbackEnabled").addEventListener("change", updateVisibility);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      status.textContent = "Saving…";
      const settings = readForm();
      const permitted = await requestProviderPermissions(settings);
      if (!permitted) {
        status.textContent = "Permission to contact the selected translation servers is required.";
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
