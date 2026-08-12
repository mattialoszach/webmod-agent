import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageAnalyzer } from "../src/content/analyzer";
import { ElementRegistry } from "../src/content/elementRegistry";

describe("PageAnalyzer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      x: 0, y: 0, top: 20, left: 10, right: 410, bottom: 100, width: 400, height: 80,
      toJSON: () => ({})
    }));
  });

  it("returns compact visible semantic elements with stable IDs", () => {
    document.body.innerHTML = `
      <header><a href="/"><svg viewBox="0 0 10 10"><path d="M0 0h10v10z" /></svg></a></header>
      <main>
        <img class="site-logo" alt="Current company logo" src="/logo.png">
        <h1 aria-label="Main title">Hello world</h1><button>Follow</button>
        <table><tbody><tr><th>Module</th><td>Interaction Design</td></tr></tbody></table>
      </main>
      <aside style="display:none">Hidden sidebar</aside>
      <script>ignore()</script>
    `;
    const analyzer = new PageAnalyzer(new ElementRegistry());
    const first = analyzer.analyze();
    const second = analyzer.analyze();
    const heading = first.elements.find((element) => element.tag === "h1");
    const logo = first.elements.find((element) => element.tag === "img");
    const headerLogoContainer = first.elements.find((element) => element.tag === "a");
    const selectedContext = heading ? analyzer.analyze(heading.id) : undefined;

    expect(heading).toMatchObject({ role: "heading", text: "Hello world", ariaLabel: "Main title" });
    expect(logo).toMatchObject({ role: "img", alt: "Current company logo", classHints: ["site-logo"] });
    expect(headerLogoContainer).toMatchObject({ landmark: "header", containsVisual: true });
    expect(first.elements.some((element) => element.tag === "td" && element.text === "Interaction Design")).toBe(true);
    expect(second.elements.find((element) => element.tag === "h1")?.id).toBe(heading?.id);
    expect(selectedContext?.elements.find((element) => element.id === heading?.id)?.relationToSelection).toBe("selected");
    expect(selectedContext?.elements.some((element) => element.relationToSelection === "parent")).toBe(true);
    expect(first.elements.some((element) => element.text === "Hidden sidebar")).toBe(false);
    expect(first.elements.some((element) => element.tag === "script")).toBe(false);
  });
});
