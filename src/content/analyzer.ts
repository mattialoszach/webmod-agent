import type { PageAnalysis, SemanticElement } from "../shared/types";
import { ElementRegistry } from "./elementRegistry";

const MAX_ELEMENTS = 180;
const CANDIDATE_SELECTOR = [
  "body", "header", "nav", "main", "aside", "section", "article", "footer",
  "h1", "h2", "h3", "h4", "p", "a", "button", "img", "svg", "input", "textarea",
  "select", "label", "form", "table", "thead", "tbody", "tr", "th", "td",
  "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption",
  "[role]", "[aria-label]", "[contenteditable='true']",
  "[class*='card' i]", "[class*='sidebar' i]", "[class*='hero' i]",
  "[class*='logo' i]", "[id*='logo' i]"
].join(",");

const STYLE_PROPERTIES = [
  "color", "background-color", "font-size", "font-weight", "display", "width", "height",
  "padding", "margin", "border-radius"
] as const;

function inferRole(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  const roles: Record<string, string> = {
    a: "link", article: "article", aside: "complementary", button: "button", footer: "contentinfo",
    form: "form", header: "banner", img: "img", input: "textbox", main: "main", nav: "navigation",
    section: "region", select: "combobox", textarea: "textbox"
  };
  return roles[tag] ?? (element.textContent?.trim() ? "text" : "container");
}

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
  if (element.closest("#webmod-picker-host, #webmod-active-indicator")) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || (style.opacity !== "" && Number(style.opacity) === 0)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function viewportPosition(element: Element): "visible" | "nearby" | undefined {
  const rect = element.getBoundingClientRect();
  const marginX = window.innerWidth * 0.75;
  const marginY = window.innerHeight * 1.25;
  const visible = rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  if (visible) return "visible";
  const nearby = rect.bottom >= -marginY && rect.right >= -marginX &&
    rect.top <= window.innerHeight + marginY && rect.left <= window.innerWidth + marginX;
  return nearby ? "nearby" : undefined;
}

function classHints(element: Element): string[] | undefined {
  const useful = [...Array.from(element.classList), element.id]
    .map((name) => name.toLowerCase())
    .filter((name) => /card|sidebar|nav|header|hero|title|content|profile|menu|footer|logo/.test(name))
    .slice(0, 4);
  return useful.length > 0 ? useful : undefined;
}

function compactText(element: Element): string | undefined {
  const raw = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? element.value
    : element.textContent;
  const text = raw?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

function semanticScore(element: Element, viewport: "visible" | "nearby"): number {
  const tag = element.tagName.toLowerCase();
  let score = viewport === "visible" ? 100 : 20;
  if (/^h[1-3]$/.test(tag)) score += 40;
  if (["button", "a", "img", "nav", "main", "header", "aside", "article", "form"].includes(tag)) score += 25;
  if (["table", "th", "td", "li", "dt", "dd"].includes(tag)) score += 15;
  if (/logo/i.test(`${element.id} ${element.getAttribute("class") ?? ""}`)) score += 35;
  if (element.hasAttribute("aria-label") || element.hasAttribute("role")) score += 15;
  const rect = element.getBoundingClientRect();
  if (rect.width * rect.height > window.innerWidth * window.innerHeight * 0.15) score += 10;
  return score;
}

function landmark(element: Element): SemanticElement["landmark"] {
  const ancestor = element.closest("header, nav, main, aside, footer");
  if (!ancestor) return undefined;
  const tag = ancestor.tagName.toLowerCase();
  const landmarks: Record<string, NonNullable<SemanticElement["landmark"]>> = {
    header: "header",
    nav: "navigation",
    main: "main",
    aside: "complementary",
    footer: "footer"
  };
  return landmarks[tag];
}

export class PageAnalyzer {
  constructor(private readonly registry: ElementRegistry) {}

  analyze(selectedElementIds: string[] = []): PageAnalysis {
    this.registry.cleanup();
    const candidates = Array.from(document.querySelectorAll(CANDIDATE_SELECTOR))
      .flatMap((element) => {
        if (!isVisible(element)) return [];
        const viewport = viewportPosition(element);
        return viewport ? [{ element, viewport, score: semanticScore(element, viewport) }] : [];
      })
      .sort((a, b) => b.score - a.score);

    const signatures = new Map<string, number>();
    const included = candidates.filter(({ element }) => {
      const signature = `${element.tagName}:${inferRole(element)}:${compactText(element)?.slice(0, 60) ?? ""}`;
      const count = signatures.get(signature) ?? 0;
      signatures.set(signature, count + 1);
      return count < 4;
    }).slice(0, MAX_ELEMENTS);

    const elements = included.map(({ element, viewport }) => this.toSemanticElement(element, viewport));
    const selectedElements = selectedElementIds.flatMap((id) => {
      const element = this.registry.getElement(id);
      return element ? [element] : [];
    });
    const selectedSet = new Set(selectedElements);
    const related = new Map<Element, "selected" | "parent" | "sibling">();
    for (const selectedElement of selectedElements) {
      related.set(selectedElement, "selected");
      const context: Array<{ element?: Element | null; relation: "parent" | "sibling" }> = [
        { element: selectedElement.parentElement, relation: "parent" },
        { element: selectedElement.previousElementSibling, relation: "sibling" },
        { element: selectedElement.nextElementSibling, relation: "sibling" }
      ];
      for (const item of context) {
        if (item.element && !selectedSet.has(item.element) && !related.has(item.element)) {
          related.set(item.element, item.relation);
        }
      }
    }
    for (const [contextElement, relation] of [...related].reverse()) {
      const id = this.registry.getId(contextElement);
      const existing = elements.find((element) => element.id === id);
      if (existing) existing.relationToSelection = relation;
      else elements.unshift(this.toSemanticElement(
        contextElement,
        viewportPosition(contextElement) ?? "nearby",
        relation
      ));
    }

    return {
      url: location.href,
      pageTitle: document.title,
      elements,
      selectedElements: selectedElements.map((element) =>
        this.toSemanticElement(element, viewportPosition(element) ?? "nearby", "selected")
      )
    };
  }

  describeElement(element: Element): SemanticElement {
    return this.toSemanticElement(element, viewportPosition(element) ?? "nearby");
  }

  private toSemanticElement(
    element: Element,
    viewport: "visible" | "nearby",
    relationToSelection?: "selected" | "parent" | "sibling"
  ): SemanticElement {
    const computed = getComputedStyle(element);
    const styles = Object.fromEntries(
      STYLE_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)])
        .filter(([, value]) => value !== "" && value !== "none" && value !== "normal")
    );
    const semantic: SemanticElement = {
      id: this.registry.getId(element),
      tag: element.tagName.toLowerCase(),
      role: inferRole(element),
      viewport
    };
    if (relationToSelection) semantic.relationToSelection = relationToSelection;
    const text = compactText(element);
    const ariaLabel = element.getAttribute("aria-label")?.trim();
    const alt = element instanceof HTMLImageElement ? element.alt.trim() : undefined;
    const placeholder = element.getAttribute("placeholder")?.trim();
    const href = element instanceof HTMLAnchorElement ? element.href : undefined;
    const src = element instanceof HTMLImageElement ? element.currentSrc || element.src : undefined;
    const hints = classHints(element);
    const elementLandmark = landmark(element);
    const containsVisual = !(element instanceof HTMLImageElement)
      && !(element instanceof SVGElement)
      && element.querySelector(":scope > img, :scope > svg") !== null;
    if (text) semantic.text = text;
    if (ariaLabel) semantic.ariaLabel = ariaLabel;
    if (alt) semantic.alt = alt;
    if (placeholder) semantic.placeholder = placeholder;
    if (href) semantic.href = href.slice(0, 500);
    if (src) semantic.src = src.slice(0, 500);
    if (hints) semantic.classHints = hints;
    if (elementLandmark) semantic.landmark = elementLandmark;
    if (containsVisual) semantic.containsVisual = true;
    if (Object.keys(styles).length > 0) semantic.styles = styles;
    return semantic;
  }
}
