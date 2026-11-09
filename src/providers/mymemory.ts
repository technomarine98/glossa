import { detectLanguage } from "../shared/settings";
import type { Language, TargetLanguage } from "../shared/types";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types";

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

export class MyMemoryProvider implements TranslationProvider {
  readonly id = "mymemory";

  async translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const resolvedSource = source === "auto" ? detectLanguage(text) : source;
    const url = new URL("https://api.mymemory.translated.net/get");
    url.searchParams.set("q", text);
    url.searchParams.set("langpair", `${resolvedSource}|${target}`);

    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new ProviderError(`MyMemory returned HTTP ${response.status}.`);
    }

    const data = (await response.json()) as MyMemoryResponse;
    const translatedText = data.responseData?.translatedText?.trim();
    if (!translatedText) {
      const detail = data.responseDetails || "MyMemory did not return a translation.";
      throw new ProviderError(detail);
    }

    return { text: translatedText, detectedLanguage: resolvedSource };
  }
}
