import type { AgentInput, WebModOperation } from "../../shared/types";

export interface AIProvider {
  generateOperations(input: AgentInput): Promise<WebModOperation[]>;
}
