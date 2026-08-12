import type { AgentInput, SemanticElement, WebModOperation } from "../../shared/types";
import type { AIProvider } from "./AIProvider";

const COLOR_NAMES = [
  "black", "white", "red", "blue", "green", "orange", "purple", "pink", "gray", "grey",
  "yellow", "teal", "navy"
];

function findFirst(input: AgentInput, predicate: (element: SemanticElement) => boolean): SemanticElement | undefined {
  if (input.selectedElementId) {
    const selected = input.elements.find((element) => element.id === input.selectedElementId);
    if (selected) return selected;
  }
  return input.elements.find(predicate);
}

function quotedOrTrailingText(instruction: string): string | undefined {
  const quoted = instruction.match(/["“']([^"”']+)["”']/)?.[1];
  if (quoted) return quoted.trim();
  return instruction.match(/(?:change|set|replace)(?:\s+this|\s+the)?(?:\s+\w+){0,3}\s+(?:text\s+)?to\s+(.+)$/i)?.[1]?.trim();
}

export class MockProvider implements AIProvider {
  async generateOperations(input: AgentInput): Promise<WebModOperation[]> {
    const instruction = input.instruction.trim();
    const lower = instruction.toLowerCase();
    const operations: WebModOperation[] = [];
    const selected = input.selectedElementId
      ? input.elements.find((element) => element.id === input.selectedElementId)
      : undefined;

    if (/payment|bank statement|passport|identity document|logged[ -]?in|authentication state/i.test(lower)) {
      return [];
    }

    const newText = quotedOrTrailingText(instruction);
    if (newText && /change|replace|set/.test(lower)) {
      const target = selected ?? findFirst(input, (element) =>
        /title|heading/.test(lower)
          ? element.role === "heading" || /^h[1-3]$/.test(element.tag)
          : Boolean(element.text)
      );
      if (target) operations.push({ type: "replaceText", elementId: target.id, value: newText });
    }

    if (/hide|remove/.test(lower)) {
      const target = selected ?? findFirst(input, (element) => {
        if (/sidebar/.test(lower)) return element.role === "complementary" || element.classHints?.includes("sidebar") === true;
        if (/nav(?:bar|igation)?/.test(lower)) return element.role === "navigation" || element.tag === "nav";
        return Boolean(element.text && lower.includes(element.text.toLowerCase().slice(0, 24)));
      });
      if (target) operations.push({ type: "hide", elementId: target.id });
    }

    const visualTarget = selected ?? findFirst(input, (element) => {
      if (/main heading|heading|title/.test(lower)) return element.role === "heading" || element.tag === "h1";
      if (/nav(?:bar|igation)?|header/.test(lower)) return element.role === "navigation" || ["nav", "header"].includes(element.tag);
      if (/sidebar/.test(lower)) return element.role === "complementary" || element.tag === "aside";
      if (/card/.test(lower)) return element.classHints?.includes("card") === true || element.role === "article";
      return element.tag === "main" || element.tag === "body";
    });

    if (visualTarget) {
      const styles: Record<string, string> = {};
      const color = COLOR_NAMES.find((name) => new RegExp(`\\b${name}\\b`).test(lower));
      const inferredColor = color ?? (/\bdark\b/.test(lower) ? "#18181b" : /\blight\b/.test(lower) ? "#f4f4f5" : undefined);
      if (inferredColor) {
        const normalized = inferredColor === "grey" ? "gray" : inferredColor;
        if (/background|navbar|navigation|header|card/.test(lower) && !/text\s+(?:to\s+)?(?:be\s+)?\w+/.test(lower)) {
          styles["background-color"] = normalized;
          if (["black", "navy", "purple", "#18181b"].includes(normalized)) styles.color = "white";
        } else {
          styles.color = normalized;
        }
      }
      if (/twice as (?:large|big)|2x/.test(lower)) styles.transform = "scale(2)";
      else if (/bigger|larger/.test(lower)) styles.transform = "scale(1.2)";
      if (/smaller|slightly smaller/.test(lower)) styles.transform = "scale(0.9)";
      if (/rounded/.test(lower)) styles["border-radius"] = "16px";
      if (/futuristic/.test(lower)) {
        styles.background = "linear-gradient(135deg, #090d1a, #172554)";
        styles.color = "#e0f2fe";
        styles["font-family"] = "Inter, system-ui, sans-serif";
      }
      if (/minimal/.test(lower)) {
        styles.background = "#ffffff";
        styles.color = "#18181b";
        styles["font-family"] = "system-ui, sans-serif";
      }
      if (Object.keys(styles).length > 0) {
        operations.push({ type: "setStyles", elementId: visualTarget.id, styles });
      }
    }

    return operations.filter((operation, index, all) =>
      all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(operation)) === index
    );
  }
}
