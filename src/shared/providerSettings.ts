import type { OpenAIModel, ProviderSettings } from "./types";

export const OPENAI_MODELS: ReadonlyArray<{
  id: OpenAIModel;
  name: string;
  description: string;
}> = [
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", description: "Balanced" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", description: "Fast & economical" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", description: "Highest capability" }
];

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: "mock",
  apiKey: "",
  model: "gpt-5.6-terra"
};

export function isOpenAIModel(value: unknown): value is OpenAIModel {
  return OPENAI_MODELS.some((model) => model.id === value);
}

export function normalizeProviderSettings(stored: Record<string, unknown>): ProviderSettings {
  return {
    provider: stored.provider === "openai" ? "openai" : "mock",
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey : "",
    model: isOpenAIModel(stored.model) ? stored.model : DEFAULT_PROVIDER_SETTINGS.model
  };
}
