import type { TargetLanguage, TranslationSettings } from "./types";

export const DEFAULT_SETTINGS: TranslationSettings = {
  enabled: true,
  autoTranslate: true,
  provider: "mymemory",
  defaultDirection: "auto",
  translationDelay: 180,
  requireModifier: false,
  modifierKey: "Alt",
  disabledSites: [],
  libreTranslateUrl: "https://libretranslate.com",
  libreTranslateApiKey: "",
  googleApiKey: "",
};

export async function getSettings(): Promise<TranslationSettings> {
  const stored = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<TranslationSettings> | undefined) };
}

export async function saveSettings(settings: TranslationSettings): Promise<void> {
  await browser.storage.local.set({ settings });
}

export function detectLanguage(text: string): TargetLanguage {
  return /[\u0400-\u04ff]/.test(text) ? "ru" : "en";
}

export function isSiteDisabled(settings: TranslationSettings, hostname: string): boolean {
  const host = hostname.toLowerCase();
  return settings.disabledSites.some((entry) => {
    const site = entry.trim().toLowerCase().replace(/^\./, "");
    return site.length > 0 && (host === site || host.endsWith(`.${site}`));
  });
}
