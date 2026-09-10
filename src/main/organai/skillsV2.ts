import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';

export const SKILL_SPEC_V1 = 'organaisation/skill@1';
export interface SkillMeta { spec: typeof SKILL_SPEC_V1; id: string; name: string; version: string; description: string; triggers: string[]; capabilities: string[]; scope: 'agent' | 'project' | 'company'; status?: 'active' | 'deprecated'; source?: string; }
export interface SkillProposal { id: string; skill: SkillMeta; body: string; source: string; kind: 'create' | 'update'; status: 'pending' | 'approved' | 'rejected'; createdAt: string; reason: string; }
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function validate(meta: unknown): { ok: true; meta: SkillMeta } | { ok: false; error: string } {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, error: 'skill metadata must be an object' }; const value = meta as Record<string, unknown>;
  if (value.spec !== SKILL_SPEC_V1 || typeof value.id !== 'string' || !SLUG.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || typeof value.version !== 'string' || !SEMVER.test(value.version) || typeof value.description !== 'string' || !value.description.trim()) return { ok: false, error: 'invalid required skill metadata' };
  if (!Array.isArray(value.triggers) || !Array.isArray(value.capabilities) || !['agent', 'project', 'company'].includes(value.scope as string) || value.triggers.some((v) => typeof v !== 'string') || value.capabilities.some((v) => typeof v !== 'string')) return { ok: false, error: 'invalid skill metadata fields' };
  return { ok: true, meta: { spec: SKILL_SPEC_V1, id: value.id, name: value.name.trim().slice(0, 100), version: value.version, description: value.description.trim().slice(0, 500), triggers: value.triggers.map((v) => v.trim()).filter(Boolean).slice(0, 16), capabilities: value.capabilities.map((v) => v.trim()).filter(Boolean).slice(0, 16), scope: value.scope as SkillMeta['scope'], status: value.status === 'deprecated' ? 'deprecated' : 'active', source: typeof value.source === 'string' ? value.source.slice(0, 240) : undefined } };
}

export class SkillRuntime {
  private readonly root: string; private readonly skillsPath: string; private readonly proposalsPath: string;
  constructor(root: string) { this.root = root; this.skillsPath = join(root, 'skills'); this.proposalsPath = join(root, 'skill-proposals.json'); mkdirSync(this.skillsPath, { recursive: true }); }
  metadata(): SkillMeta[] { try { return readdirSync(this.skillsPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => { try { const parsed = validate(JSON.parse(readFileSync(join(this.skillsPath, entry.name, 'meta.json'), 'utf8'))); return parsed.ok ? [parsed.meta] : []; } catch { return []; } }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; } }
  load(id: string): { meta: SkillMeta; body: string } | null { if (!SLUG.test(id)) return null; const dir = resolve(this.skillsPath, id); if (!dir.startsWith(resolve(this.skillsPath) + sep)) return null; try { const parsed = validate(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))); if (!parsed.ok) return null; return { meta: parsed.meta, body: readFileSync(join(dir, 'SKILL.md'), 'utf8') }; } catch { return null; } }
  propose(input: { skill: unknown; body: unknown; source: unknown; reason: unknown; kind?: unknown }): { ok: boolean; proposal?: SkillProposal; error?: string } {
    const parsed = validate(input.skill); if (!parsed.ok) return parsed; const body = typeof input.body === 'string' ? input.body.trim().slice(0, 30_000) : ''; if (!body || !/^#\s+Skill:/mi.test(body)) return { ok: false, error: 'SKILL.md must begin with a Skill heading' }; const source = typeof input.source === 'string' ? input.source.trim().slice(0, 240) : ''; const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''; if (!source || !reason) return { ok: false, error: 'source task/session and reason are required' };
    const existing = this.load(parsed.meta.id); const kind = input.kind === 'update' ? 'update' : 'create'; if (kind === 'create' && existing) return { ok: false, error: 'skill already exists; submit an update proposal' }; if (kind === 'update' && !existing) return { ok: false, error: 'skill does not exist; submit a create proposal' };
    const proposal: SkillProposal = { id: randomUUID(), skill: parsed.meta, body, source, kind, status: 'pending', createdAt: new Date().toISOString(), reason }; const all = this.proposals(); all.push(proposal); this.save(all); return { ok: true, proposal };
  }
  proposals(status?: SkillProposal['status']): SkillProposal[] { try { const values = JSON.parse(readFileSync(this.proposalsPath, 'utf8')); return Array.isArray(values) ? values.filter((value): value is SkillProposal => value && typeof value.id === 'string' && (!status || value.status === status)) : []; } catch { return []; } }
  decide(id: string, approve: boolean): { ok: boolean; error?: string; meta?: SkillMeta } { const all = this.proposals(); const proposal = all.find((item) => item.id === id); if (!proposal || proposal.status !== 'pending') return { ok: false, error: 'pending proposal not found' }; proposal.status = approve ? 'approved' : 'rejected'; if (!approve) { this.save(all); return { ok: true }; }
    const previous = this.load(proposal.skill.id); if (proposal.kind === 'update' && previous) this.archive(previous.meta, previous.body); const result = this.writeSkill(proposal.skill, proposal.body); this.save(all); return result.ok ? { ok: true, meta: proposal.skill } : result;
  }
  private writeSkill(meta: SkillMeta, body: string): { ok: boolean; error?: string } { try { const dir = join(this.skillsPath, meta.id); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'meta.json.tmp'), JSON.stringify(meta, null, 2)); writeFileSync(join(dir, 'SKILL.md.tmp'), body); renameSync(join(dir, 'meta.json.tmp'), join(dir, 'meta.json')); renameSync(join(dir, 'SKILL.md.tmp'), join(dir, 'SKILL.md')); return { ok: true }; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; } }
  private archive(meta: SkillMeta, body: string): void { const dir = join(this.root, 'skill-history', meta.id, meta.version); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2)); writeFileSync(join(dir, 'SKILL.md'), body); }
  private save(values: SkillProposal[]): void { mkdirSync(this.root, { recursive: true }); writeFileSync(this.proposalsPath, JSON.stringify(values, null, 2)); }
}
