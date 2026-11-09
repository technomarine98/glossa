import { GoogleProvider } from "../providers/google";
import { LibreTranslateProvider } from "../providers/libretranslate";
import { MyMemoryProvider } from "../providers/mymemory";
import type { TranslationProvider, TranslationResult } from "../providers/types";
import { detectLanguage } from "../shared/settings";
import type { Language, TargetLanguage, TranslationSettings } from "../shared/types";

function createProvider(settings: TranslationSettings): TranslationProvider {
  switch (settings.provider) {
    case "google":
      return new GoogleProvider(settings.googleApiKey);
    case "libretranslate":
      return new LibreTranslateProvider(settings.libreTranslateUrl, settings.libreTranslateApiKey);
    case "mymemory":
      return new MyMemoryProvider();
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
