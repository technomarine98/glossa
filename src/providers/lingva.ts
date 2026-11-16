import type { Language, TargetLanguage } from "../shared/types";
import { rateLimitError, readProviderJson } from "./http";
import { ProviderError, type TranslationProvider, type TranslationResult } from "./types";

interface LingvaResponse {
  translation?: string;
  info?: { detectedSource?: string };
  error?: string;
}

export class LingvaProvider implements TranslationProvider {
  readonly id = "lingva";

  constructor(private readonly baseUrl: string) {}

  async translate(
    text: string,
    source: Language,
    target: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    let endpoint: URL;
    try {
      endpoint = new URL(this.baseUrl);
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error();
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/api/v1/${source}/${target}/${encodeURIComponent(text)}`;
      endpoint.search = "";
      endpoint.hash = "";
    } catch {
      throw new ProviderError("Enter a valid Lingva server URL in settings.");
    }

    const response = await fetch(endpoint, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    const data = await readProviderJson<LingvaResponse>(response, "Lingva");
    if (response.status === 429) throw rateLimitError(response, "Lingva");
    if (!response.ok || data.error) {
      throw new ProviderError(data.error || `Lingva returned HTTP ${response.status}.`, true);
    }
    if (typeof data.translation !== "string" || !data.translation.trim()) {
      throw new ProviderError("Lingva did not return a translation.", true);
    }
    return { text: data.translation, detectedLanguage: data.info?.detectedSource };
  }
}
