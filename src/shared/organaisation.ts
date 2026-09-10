import { AGENT_PROVIDER_PRESETS, type AgentProvider } from './agentProvider';

export const ROSTER_SPEC_V1 = 'organaisation/roster@1';

export interface ActorProfile {
  id: string;
  name: string;
  kind: 'ai';
  role: string;
  description?: string;
  goal: string;
  provider: AgentProvider;
  model?: string;
  reasoning?: string;
  capabilities: string[];
  skillIds: string[];
  memoryProfileId: string;
  autonomyProfileId?: string;
  tokenCap?: number;
  isolate?: boolean;
}

export interface OrganisationRoster {
  spec: typeof ROSTER_SPEC_V1;
  name: string;
  orchestrator?: string;
  agents: ActorProfile[];
}

export interface RosterValidation {
  ok: boolean;
  roster?: OrganisationRoster;
  errors: string[];
}

/** The runtime registry is the single provider source for every new roster flow.
 * `custom` intentionally remains excluded because a portable roster may not carry
 * arbitrary executable commands. */
export function rosterProviders(): readonly AgentProvider[] {
  return AGENT_PROVIDER_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => preset.id);
}

function text(value: unknown, field: string, errors: string[], max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) errors.push(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') { errors.push(`${field} must be a string`); return undefined; }
  const cleaned = value.trim();
  if (required && !cleaned) { errors.push(`${field} must not be empty`); return undefined; }
  if (cleaned.length > max) { errors.push(`${field} exceeds ${max} characters`); return undefined; }
  return cleaned || undefined;
}

function tags(value: unknown, field: string, errors: string[], max = 16): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some((tag) => typeof tag !== 'string')) {
    errors.push(`${field} must be an array of at most ${max} strings`);
    return [];
  }
  return [...new Set(value.map((tag) => tag.trim()).filter(Boolean).map((tag) => tag.slice(0, 80)))];
}

/** Pure, deliberately conservative parser for untrusted roster JSON. Importing a
 * valid roster only creates reviewable drafts; it never spawns a process. */
export function validateOrganisationRoster(raw: unknown): RosterValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['roster must be an object'] };
  const value = raw as Record<string, unknown>;
  if (value.spec !== ROSTER_SPEC_V1) return { ok: false, errors: [`unsupported spec (expected ${ROSTER_SPEC_V1})`] };
  const name = text(value.name, 'name', errors, 100, true);
  const orchestrator = text(value.orchestrator, 'orchestrator', errors, 80);
  if (!Array.isArray(value.agents) || value.agents.length === 0 || value.agents.length > 64) {
    errors.push('agents must contain 1–64 entries');
    return { ok: false, errors };
  }
  const knownProviders = new Set(rosterProviders());
  const ids = new Set<string>();
  const agents: ActorProfile[] = [];
  value.agents.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) { errors.push(`agents[${index}] must be an object`); return; }
    const agent = candidate as Record<string, unknown>;
    const id = text(agent.id, `agents[${index}].id`, errors, 64, true)?.toLowerCase();
    const agentName = text(agent.name, `agents[${index}].name`, errors, 40, true);
    const role = text(agent.role, `agents[${index}].role`, errors, 160, true);
    const goal = text(agent.goal, `agents[${index}].goal`, errors, 4000, true);
    const provider = typeof agent.provider === 'string' ? agent.provider : '';
    if (!knownProviders.has(provider as AgentProvider)) errors.push(`agents[${index}].provider is not a supported runtime provider`);
    if (id && ids.has(id)) errors.push(`duplicate agent id ${id}`);
    if (id) ids.add(id);
    const model = text(agent.model, `agents[${index}].model`, errors, 120);
    const reasoning = text(agent.reasoning, `agents[${index}].reasoning`, errors, 40);
    const description = text(agent.description, `agents[${index}].description`, errors, 240);
    const memoryProfileId = text(agent.memoryProfileId, `agents[${index}].memoryProfileId`, errors, 80) ?? `agent:${id ?? index}`;
    const autonomyProfileId = text(agent.autonomyProfileId, `agents[${index}].autonomyProfileId`, errors, 80);
    // bootstrap_roster.py originally emitted snake_case. Accept that spelling as
    // a compatibility alias so its practical test roster retains its budgets.
    const rawTokenCap = agent.tokenCap ?? agent.token_cap;
    const tokenCap = rawTokenCap === undefined ? undefined : (typeof rawTokenCap === 'number' && Number.isInteger(rawTokenCap) && rawTokenCap > 0 && rawTokenCap <= 10_000_000_000 ? rawTokenCap : undefined);
    if (rawTokenCap !== undefined && tokenCap === undefined) errors.push(`agents[${index}].tokenCap must be a positive integer ≤ 1e10`);
    if (agent.isolate !== undefined && typeof agent.isolate !== 'boolean') errors.push(`agents[${index}].isolate must be boolean`);
    if (id && agentName && role && goal && knownProviders.has(provider as AgentProvider)) {
      agents.push({ id, name: agentName, kind: 'ai', role, description, goal, provider: provider as AgentProvider, model, reasoning, capabilities: tags(agent.capabilities, `agents[${index}].capabilities`, errors), skillIds: tags(agent.skillIds ?? agent.skills, `agents[${index}].skillIds`, errors), memoryProfileId, autonomyProfileId, tokenCap, isolate: agent.isolate === true });
    }
  });
  if (orchestrator && !ids.has(orchestrator.toLowerCase())) errors.push('orchestrator must reference an agent id');
  if (errors.length || !name) return { ok: false, errors };
  return { ok: true, roster: { spec: ROSTER_SPEC_V1, name, orchestrator: orchestrator?.toLowerCase(), agents }, errors: [] };
}

/** A draft shaped for the existing Add Agent review modal. The caller retains the
 * review gate and is solely responsible for any later process spawn. */
export function rosterAgentToHireDraft(agent: ActorProfile) {
  return {
    spec: 'munder-difflin/hire@1' as const,
    name: agent.name,
    description: agent.role,
    goal: agent.goal,
    provider: agent.provider,
    model: agent.model,
    capabilities: agent.capabilities,
    isolate: agent.isolate ?? false,
    tokenCap: agent.tokenCap,
    skills: agent.skillIds
  };
}
