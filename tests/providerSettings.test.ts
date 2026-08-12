import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_SETTINGS,
  normalizeProviderSettings
} from "../src/shared/providerSettings";

describe("provider settings", () => {
  it("uses the safe offline demo defaults for missing values", () => {
    expect(normalizeProviderSettings({})).toEqual(DEFAULT_PROVIDER_SETTINGS);
  });

  it("accepts only selectable OpenAI models", () => {
    expect(normalizeProviderSettings({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-5.6-sol"
    })).toEqual({ provider: "openai", apiKey: "sk-test", model: "gpt-5.6-sol" });

    expect(normalizeProviderSettings({ model: "made-up-model" }).model)
      .toBe(DEFAULT_PROVIDER_SETTINGS.model);
  });
});
