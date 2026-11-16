import { detectLanguage } from "../shared/settings";
import type { Language, TargetLanguage } from "../shared/types";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types";
import { rateLimitError, readProviderJson } from "./http";

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
  quotaFinished?: boolean;
}

export class MyMemoryProvider implements TranslationProvider {
  readonly id = "mymemory";

  constructor(private readonly email = "") {}

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
    if (this.email) url.searchParams.set("de", this.email);

    const response = await fetch(url, { signal });
    const data = await readProviderJson<MyMemoryResponse>(response, "MyMemory");
    const translatedText = data.responseData?.translatedText?.trim();
    const detail = [data.responseDetails, translatedText].filter(Boolean).join(" ");
    const dailyLimit = data.quotaFinished === true || /USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY/i.test(detail);
    if (response.status === 429 || Number(data.responseStatus) === 429 || dailyLimit) {
      throw rateLimitError(response, "MyMemory", detail, dailyLimit);
    }
    if (!response.ok) {
      throw new ProviderError(`MyMemory returned HTTP ${response.status}.`, response.status >= 500 || response.status === 408);
    }
    if (data.responseStatus !== undefined && Number(data.responseStatus) !== 200) {
      throw new ProviderError(data.responseDetails || `MyMemory returned status ${data.responseStatus}.`, Number(data.responseStatus) >= 500);
    }
    if (!translatedText) {
      const detail = data.responseDetails || "MyMemory did not return a translation.";
      throw new ProviderError(detail, true);
    }

    return { text: translatedText, detectedLanguage: resolvedSource };
  }
}
