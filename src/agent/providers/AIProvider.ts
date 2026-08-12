import type { AgentInput, AgentPlan } from "../../shared/types";

export interface AIProvider {
  generatePlan(input: AgentInput): Promise<AgentPlan>;
}
