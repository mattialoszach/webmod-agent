export interface SemanticElement {
  id: string;
  tag: string;
  role: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  src?: string;
  classHints?: string[];
  styles?: Record<string, string>;
  viewport: "visible" | "nearby";
  relationToSelection?: "selected" | "parent" | "sibling";
}

export interface AgentInput {
  instruction: string;
  url: string;
  pageTitle: string;
  elements: SemanticElement[];
  selectedElementId?: string;
}

export type WebModOperation =
  | { type: "replaceText"; elementId: string; value: string }
  | { type: "setStyles"; elementId: string; styles: Record<string, string> }
  | { type: "hide"; elementId: string }
  | { type: "replaceImage"; elementId: string; src: string }
  | {
      type: "setAttribute";
      elementId: string;
      attribute: "alt" | "title" | "aria-label" | "placeholder" | "href" | "target";
      value: string;
    };

export interface PageAnalysis {
  url: string;
  pageTitle: string;
  elements: SemanticElement[];
  selectedElement?: SemanticElement;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  changeCount: number;
}

export interface PageContext {
  analysis: PageAnalysis;
  history: HistoryState;
}

export type OpenAIModel = "gpt-5.6-terra" | "gpt-5.6-luna" | "gpt-5.6-sol";

export interface ProviderSettings {
  provider: "mock" | "openai";
  apiKey: string;
  model: OpenAIModel;
}
