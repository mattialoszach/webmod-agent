import { operationEnvelopeSchema } from "../schemas";
import { PLANNER_SYSTEM_PROMPT } from "../prompt";
import type { AgentInput, AgentPlan, WebModOperation, WebSource } from "../../shared/types";
import type { AIProvider } from "./AIProvider";

interface OpenAIUrlReference {
  url?: string;
  title?: string;
}

interface OpenAIImageResult {
  type?: string;
  image_url?: string;
  thumbnail_url?: string;
  source_website_url?: string;
  caption?: string;
}

interface WebContext {
  summary: string;
  sources: WebSource[];
  images: Array<{
    image_url: string;
    source_website_url?: string;
    caption?: string;
  }>;
}

const WEB_SEARCH_SYSTEM_PROMPT = `You are WebMod Agent's bounded web research helper. Search only for information or images needed to fulfill the user's requested local webpage modification. Return a concise factual summary. Do not propose DOM operations, navigate the user's tab, or take actions on remote websites.`;

interface OpenAIResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: OpenAIUrlReference[];
    }>;
    action?: { sources?: OpenAIUrlReference[] };
    results?: OpenAIImageResult[];
  }>;
  error?: { message?: string };
}

function normalizedHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

function sourceTitle(url: string, title?: string): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed.slice(0, 200);
  try {
    return new URL(url).hostname;
  } catch {
    return "Web source";
  }
}

function collectSources(body: OpenAIResponse): WebSource[] {
  const candidates: OpenAIUrlReference[] = [];
  for (const item of body.output ?? []) {
    candidates.push(...(item.action?.sources ?? []));
    for (const content of item.content ?? []) candidates.push(...(content.annotations ?? []));
    for (const result of item.results ?? []) {
      candidates.push({ url: result.source_website_url, title: result.caption });
    }
  }
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const candidate of candidates) {
    const url = normalizedHttpUrl(candidate.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, title: sourceTitle(url, candidate.title) });
    if (sources.length === 8) break;
  }
  return sources;
}

function collectImageResultUrls(body: OpenAIResponse): Set<string> {
  const urls = new Set<string>();
  for (const item of body.output ?? []) {
    for (const result of item.results ?? []) {
      if (result.type !== "image_result") continue;
      const url = normalizedHttpUrl(result.image_url);
      if (url) urls.add(url);
      const thumbnailUrl = normalizedHttpUrl(result.thumbnail_url);
      if (thumbnailUrl) urls.add(thumbnailUrl);
    }
  }
  return urls;
}

function collectImageResults(body: OpenAIResponse): WebContext["images"] {
  const images: WebContext["images"] = [];
  for (const item of body.output ?? []) {
    for (const result of item.results ?? []) {
      if (result.type !== "image_result") continue;
      const imageUrl = normalizedHttpUrl(result.image_url);
      if (!imageUrl) continue;
      const sourceWebsiteUrl = normalizedHttpUrl(result.source_website_url);
      images.push({
        image_url: imageUrl,
        ...(sourceWebsiteUrl ? { source_website_url: sourceWebsiteUrl } : {}),
        ...(result.caption?.trim() ? { caption: result.caption.trim().slice(0, 500) } : {})
      });
      if (images.length === 5) return images;
    }
  }
  return images;
}

function responseOutputText(body: OpenAIResponse): string | undefined {
  return body.output_text ?? body.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === "output_text")?.text;
}

function instructionContainsUrl(instruction: string): boolean {
  return /https?:\/\/[^\s<>"']+/i.test(instruction);
}

function shouldUseWebSearch(instruction: string): boolean {
  if (instructionContainsUrl(instruction)) return false;
  const explicitSearch = /\b(?:search|browse|look\s*up|find\s+online|find\s+on\s+the\s+web|from\s+the\s+web|online)\b/i;
  const timeSensitive = /\b(?:latest|today|recent|up-to-date)\b/i;
  const currentFact = /\bcurrent\b.*\b(?:population|weather|price|score|president|ceo|news|information|data)\b/i;
  const imageDiscovery = /\b(?:find|get|take|choose|make|use|replace|swap|change|set|put)\b.*\b(?:image|picture|photo|wallpaper|logo)\b/i.test(instruction)
    || /\b(?:image|picture|photo|logo)\b.*\b(?:background|wallpaper|instead|replace)\b/i.test(instruction);
  return explicitSearch.test(instruction) || timeSensitive.test(instruction)
    || currentFact.test(instruction) || imageDiscovery || isBackgroundImageRequest(instruction);
}

function isLogoReplacement(instruction: string): boolean {
  return /\b(?:replace|swap|take|use|change)\b.*\blogo\b|\blogo\b.*\b(?:instead|replace|with)\b/i.test(instruction);
}

function isBackgroundImageRequest(instruction: string): boolean {
  return /\b(?:background|wallpaper)\b.*\b(?:image|picture|photo)\b|\b(?:image|picture|photo)\b.*\b(?:background|wallpaper)\b/i.test(instruction);
}

function imageCompatible(element: AgentInput["elements"][number]): boolean {
  return ["img", "svg"].includes(element.tag)
    || element.role === "img"
    || element.containsVisual === true
    || element.classHints?.some((hint) => hint.includes("logo")) === true;
}

function logoScore(element: AgentInput["elements"][number]): number {
  let score = 0;
  if (/logo/i.test(`${element.alt ?? ""} ${element.ariaLabel ?? ""} ${element.src ?? ""} ${element.classHints?.join(" ") ?? ""}`)) score += 100;
  if (["img", "svg"].includes(element.tag) || element.role === "img") score += 25;
  if (element.containsVisual) score += 20;
  if (element.landmark === "header" || element.landmark === "navigation") score += 45;
  if (element.viewport === "visible") score += 5;
  return score;
}

function selectedElements(input: AgentInput): AgentInput["elements"] {
  const ids = new Set(input.selectedElementIds ?? []);
  return input.elements.filter((element) => ids.has(element.id));
}

function findLogoTarget(input: AgentInput): AgentInput["elements"][number] | undefined {
  const selected = selectedElements(input).find(imageCompatible);
  if (selected) return selected;
  const ranked = input.elements
    .filter(imageCompatible)
    .map((element) => ({ element, score: logoScore(element) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 70 ? ranked[0].element : undefined;
}

function findBackgroundTarget(input: AgentInput): AgentInput["elements"][number] | undefined {
  const selected = selectedElements(input)[0];
  if (selected) return selected;
  return input.elements.find((element) => element.tag === "body")
    ?? input.elements.find((element) => element.tag === "main" || element.role === "main")
    ?? input.elements.find((element) => ["section", "article"].includes(element.tag));
}

function explicitInstructionImageUrl(instruction: string): string | undefined {
  const match = instruction.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  return normalizedHttpUrl(match);
}

function explicitlyAvailableImageUrls(input: AgentInput): Set<string> {
  const urls = new Set<string>();
  for (const match of input.instruction.match(/https?:\/\/[^\s<>"']+/gi) ?? []) {
    const url = normalizedHttpUrl(match);
    if (url) urls.add(url);
  }
  for (const element of input.elements) {
    const url = normalizedHttpUrl(element.src);
    if (url) urls.add(url);
  }
  return urls;
}

function assertImageUrlsAreGrounded(
  operations: WebModOperation[],
  input: AgentInput,
  body: OpenAIResponse
): void {
  const allowed = explicitlyAvailableImageUrls(input);
  for (const url of collectImageResultUrls(body)) allowed.add(url);
  for (const operation of operations) {
    if (operation.type !== "replaceImage" && operation.type !== "setBackgroundImage") continue;
    const normalized = normalizedHttpUrl(operation.src);
    if (!normalized || !allowed.has(normalized)) {
      throw new Error("The planner returned an image URL that was not provided by you or found in image search.");
    }
  }
}

export class OpenAIProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  private async createResponse(payload: Record<string, unknown>): Promise<OpenAIResponse> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const body = await response.json() as OpenAIResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI request failed (${response.status})`);
    }
    return body;
  }

  private async searchWeb(input: AgentInput): Promise<OpenAIResponse> {
    return this.createResponse({
      model: this.model,
      store: false,
      tools: [{
        type: "web_search",
        search_content_types: ["image", "text"],
        image_settings: { max_results: 5, caption: true }
      }],
      tool_choice: "required",
      include: ["web_search_call.action.sources", "web_search_call.results"],
      input: [
        { role: "system", content: WEB_SEARCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            instruction: input.instruction,
            pageUrl: input.url,
            pageTitle: input.pageTitle
          })
        }
      ]
    });
  }

  async generatePlan(input: AgentInput): Promise<AgentPlan> {
    const searchResponse = shouldUseWebSearch(input.instruction)
      ? await this.searchWeb(input)
      : undefined;
    const sources = searchResponse ? collectSources(searchResponse) : [];
    const webContext: WebContext | undefined = searchResponse ? {
      summary: responseOutputText(searchResponse)?.slice(0, 8_000) ?? "",
      sources,
      images: collectImageResults(searchResponse)
    } : undefined;
    const body = await this.createResponse({
      model: this.model,
      store: false,
      input: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ ...input, ...(webContext ? { webContext } : {}) }) }
      ],
      text: {
        format: { type: "json_object" }
      }
    });

    const outputText = responseOutputText(body);
    if (!outputText) throw new Error("The model returned no structured output.");

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error("The model returned malformed JSON.");
    }
    let operations = operationEnvelopeSchema.parse(parsed).operations;
    if (searchResponse && isLogoReplacement(input.instruction)) {
      const image = collectImageResults(searchResponse)[0];
      if (!image) {
        throw new Error("Web search did not return a usable image for the replacement. Try describing the image more specifically or provide a direct image URL.");
      }
      const target = findLogoTarget(input);
      if (!target) {
        throw new Error("I found a replacement image but could not confidently identify the current logo. Select the logo and try again.");
      }
      operations = [{ type: "replaceImage", elementId: target.id, src: image.image_url }];
    } else if (operations.length === 0 && isBackgroundImageRequest(input.instruction)) {
      const imageUrl = explicitInstructionImageUrl(input.instruction)
        ?? (searchResponse ? collectImageResults(searchResponse)[0]?.image_url : undefined);
      if (!imageUrl) {
        throw new Error("No usable background image was found. Try describing the image more specifically or provide a direct image URL.");
      }
      const target = findBackgroundTarget(input);
      if (!target) {
        throw new Error("I found a background image but could not identify the page container. Select the element that should receive the background and try again.");
      }
      operations = [{
        type: "setBackgroundImage",
        elementId: target.id,
        src: imageUrl,
        fit: /\b(?:contain|entire|whole image)\b/i.test(input.instruction) ? "contain" : "cover",
        position: "center"
      }];
    }
    assertImageUrlsAreGrounded(operations, input, searchResponse ?? { output: [] });
    return { operations, sources, imageCandidates: [...collectImageResultUrls(searchResponse ?? { output: [] })] };
  }
}
