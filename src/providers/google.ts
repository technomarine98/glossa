import type { Language, TargetLanguage } from "../shared/types";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types";

interface GoogleResponse {
  data?: {
    translations?: Array<{
      translatedText?: string;
      detectedSourceLanguage?: string;
    }>;
  };
  error?: { message?: string };
}

export class GoogleProvider implements TranslationProvider {
  readonly id = "google";

  constructor(private readonly apiKey: string) {}

  async translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (!this.apiKey) {
      throw new ProviderError("Add a Google Cloud API key in the extension settings.");
    }

    const url = new URL("https://translation.googleapis.com/language/translate/v2");
    url.searchParams.set("key", this.apiKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q: text, source, target, format: "text" }),
      signal,
    });
    const data = (await response.json()) as GoogleResponse;
    if (!response.ok) {
      throw new ProviderError(data.error?.message || `Google Cloud returned HTTP ${response.status}.`);
    }

    const translation = data.data?.translations?.[0];
    if (!translation?.translatedText) {
      throw new ProviderError("Google Cloud did not return a translation.");
    }

    return {
      text: translation.translatedText,
      detectedLanguage: translation.detectedSourceLanguage,
    };
  }
}
