import { operationEnvelopeSchema } from "../schemas";
import { PLANNER_SYSTEM_PROMPT } from "../prompt";
import type { AgentInput, WebModOperation } from "../../shared/types";
import type { AIProvider } from "./AIProvider";

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async generateOperations(input: AgentInput): Promise<WebModOperation[]> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        input: [
          { role: "system", content: PLANNER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) }
        ],
        text: {
          format: { type: "json_object" }
        }
      })
    });

    const body = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI request failed (${response.status})`);
    }

    const outputText = body.output_text ?? body.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === "output_text")?.text;
    if (!outputText) throw new Error("The model returned no structured output.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error("The model returned malformed JSON.");
    }
    return operationEnvelopeSchema.parse(parsed).operations;
  }
}
