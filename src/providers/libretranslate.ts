import type { Language, TargetLanguage } from "../shared/types";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types";
import { rateLimitError, readProviderJson } from "./http";

interface LibreTranslateResponse {
  translatedText?: string;
  detectedLanguage?: string | { language?: string };
  error?: string;
}

export class LibreTranslateProvider implements TranslationProvider {
  readonly id = "libretranslate";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    let endpoint: URL;
    try {
      endpoint = new URL("translate", this.baseUrl.replace(/\/$/, "") + "/");
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
    } catch {
      throw new ProviderError("Enter a valid LibreTranslate URL in the extension settings.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source,
        target,
        format: "text",
        api_key: this.apiKey || undefined,
      }),
      signal,
    });
    const data = await readProviderJson<LibreTranslateResponse>(response, "LibreTranslate");
    if (response.status === 429) throw rateLimitError(response, "LibreTranslate");
    if (!response.ok) {
      throw new ProviderError(data.error || `LibreTranslate returned HTTP ${response.status}.`, response.status >= 500 || response.status === 408);
    }
    if (!data.translatedText?.trim()) {
      throw new ProviderError("LibreTranslate did not return a translation.", true);
    }

    const detectedLanguage = typeof data.detectedLanguage === "string"
      ? data.detectedLanguage
      : data.detectedLanguage?.language;
    return { text: data.translatedText, detectedLanguage };
  }
}
