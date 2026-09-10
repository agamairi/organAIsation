import Database from 'better-sqlite3';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export type MemoryScope = 'agent' | 'founder' | 'project' | 'company' | 'session';
export interface MemoryEntry { id: string; scope: MemoryScope; ownerId?: string; projectId?: string; content: string; source: string; confidence: number; pinned?: boolean; createdAt: string; updatedAt: string; lastUsedAt?: string; supersedes?: string; contradictedBy?: string; }
export interface MemoryCandidate { id: string; scope: Exclude<MemoryScope, 'session'>; ownerId?: string; projectId?: string; content: string; reason: string; confidence: number; source: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; }
export interface MemoryQuery { query: string; agentId?: string; projectId?: string; includeCompany?: boolean; includeFounder?: boolean; limit?: number; budgetChars?: number; }
export interface MemoryHit extends MemoryEntry { score: number; }

const SENSITIVE = /(?:api[_ -]?key|password|secret|token|private[_ -]?key|bearer\s+[A-Za-z0-9._-]{12,})/i;
const now = () => new Date().toISOString();
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export class MemoryV2Service {
  private db: Database.Database | null = null;
  private readonly root: string;
  private readonly fallbackPath: string;
  private fallback: { memories: MemoryEntry[]; candidates: MemoryCandidate[] } = { memories: [], candidates: [] };
  constructor(root: string) {
    this.root = root; this.fallbackPath = join(root, 'index.fallback.json'); mkdirSync(root, { recursive: true });
    try { this.db = new Database(join(root, 'index.sqlite'));
    this.db.exec(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT, project_id TEXT, content TEXT NOT NULL, source TEXT NOT NULL, confidence REAL NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, supersedes TEXT, contradicted_by TEXT);
      CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT, project_id TEXT, content TEXT NOT NULL, reason TEXT NOT NULL, confidence REAL NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content);`); } catch {
      this.db = null;
      try { const parsed = JSON.parse(readFileSync(this.fallbackPath, 'utf8')); if (Array.isArray(parsed.memories) && Array.isArray(parsed.candidates)) this.fallback = parsed; } catch { /* first start */ }
    }
  }
  close(): void { this.db?.close(); }
  write(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): { ok: boolean; entry?: MemoryEntry; error?: string } {
    const content = clean(entry.content, 8_000); if (!content) return { ok: false, error: 'memory content is required' }; if (SENSITIVE.test(content)) return { ok: false, error: 'refusing potential secret in durable memory' };
    if (!['agent', 'founder', 'project', 'company', 'session'].includes(entry.scope)) return { ok: false, error: 'invalid memory scope' };
    if (entry.scope === 'agent' && !entry.ownerId) return { ok: false, error: 'agent memory requires an owner' }; if (entry.scope === 'project' && !entry.projectId) return { ok: false, error: 'project memory requires a project id' };
    const time = now(); const item: MemoryEntry = { id: entry.id ?? randomUUID(), scope: entry.scope, ownerId: clean(entry.ownerId, 100) || undefined, projectId: clean(entry.projectId, 100) || undefined, content, source: clean(entry.source, 240) || 'manual', confidence: Math.max(0, Math.min(1, Number(entry.confidence) || 0.5)), pinned: entry.pinned === true, createdAt: time, updatedAt: time, lastUsedAt: entry.lastUsedAt, supersedes: entry.supersedes, contradictedBy: entry.contradictedBy };
    if (this.db) { this.db.prepare(`INSERT INTO memories (id,scope,owner_id,project_id,content,source,confidence,pinned,created_at,updated_at,last_used_at,supersedes,contradicted_by) VALUES (@id,@scope,@ownerId,@projectId,@content,@source,@confidence,@pinned,@createdAt,@updatedAt,@lastUsedAt,@supersedes,@contradictedBy)`).run({ ...item, pinned: item.pinned ? 1 : 0 }); this.db.prepare('INSERT INTO memories_fts (id, content) VALUES (?, ?)').run(item.id, item.content); } else { this.fallback.memories.push(item); this.saveFallback(); }
    this.writeMirror(item); return { ok: true, entry: item };
  }
  propose(input: Omit<MemoryCandidate, 'id' | 'createdAt' | 'status'> & { id?: string }): { ok: boolean; candidate?: MemoryCandidate; error?: string } {
    const content = clean(input.content, 8_000); const reason = clean(input.reason, 1000); if (!content || !reason) return { ok: false, error: 'candidate content and reason are required' }; if (SENSITIVE.test(content)) return { ok: false, error: 'refusing potential secret in memory candidate' };
    if (!['agent', 'founder', 'project', 'company'].includes(input.scope)) return { ok: false, error: 'invalid candidate scope' };
    if (input.scope === 'agent' && !clean(input.ownerId, 100)) return { ok: false, error: 'agent memory requires an owner' };
    if (input.scope === 'project' && !clean(input.projectId, 100)) return { ok: false, error: 'project memory requires a project id' };
    const candidate: MemoryCandidate = { id: input.id ?? randomUUID(), scope: input.scope, ownerId: input.ownerId, projectId: input.projectId, content, reason, confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0.5)), source: clean(input.source, 240) || 'session', status: 'pending', createdAt: now() };
    if (this.db) this.db.prepare('INSERT INTO candidates (id,scope,owner_id,project_id,content,reason,confidence,source,status,created_at) VALUES (@id,@scope,@ownerId,@projectId,@content,@reason,@confidence,@source,@status,@createdAt)').run(candidate); else { this.fallback.candidates.push(candidate); this.saveFallback(); } return { ok: true, candidate };
  }
  decideCandidate(id: string, approve: boolean): { ok: boolean; error?: string; entry?: MemoryEntry } {
    const row = this.db ? this.db.prepare('SELECT * FROM candidates WHERE id=?').get(id) as Record<string, unknown> | undefined : this.fallback.candidates.find((candidate) => candidate.id === id); const candidate = row && (this.db ? this.candidate(row as Record<string, unknown>) : row as MemoryCandidate); if (!candidate || candidate.status !== 'pending') return { ok: false, error: 'pending candidate not found' };
    candidate.status = approve ? 'approved' : 'rejected'; if (this.db) this.db.prepare('UPDATE candidates SET status=? WHERE id=?').run(candidate.status, id); else this.saveFallback(); if (!approve) return { ok: true };
    const result = this.write({ scope: candidate.scope, ownerId: candidate.ownerId, projectId: candidate.projectId, content: candidate.content, source: candidate.source, confidence: candidate.confidence }); return result.ok ? { ok: true, entry: result.entry } : { ok: false, error: result.error };
  }
  candidates(status: 'pending' | 'approved' | 'rejected' = 'pending'): MemoryCandidate[] { return this.db ? (this.db.prepare('SELECT * FROM candidates WHERE status=? ORDER BY created_at DESC').all(status) as Record<string, unknown>[]).map((row) => this.candidate(row)) : this.fallback.candidates.filter((candidate) => candidate.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  retrieve(query: MemoryQuery): MemoryHit[] {
    const words = clean(query.query, 500).match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0, 12) ?? []; if (!words.length) return [];
    const clauses = ['m.contradicted_by IS NULL']; const params: unknown[] = [];
    const visibility: string[] = [];
    if (query.agentId) { visibility.push('(m.scope = ? AND m.owner_id = ?)'); params.push('agent', query.agentId); }
    if (query.includeFounder !== false) visibility.push("m.scope = 'founder'"); if (query.includeCompany !== false) visibility.push("m.scope = 'company'"); if (query.projectId) { visibility.push('(m.scope = ? AND m.project_id = ?)'); params.push('project', query.projectId); }
    if (!visibility.length) return [];
    clauses.push(`(${visibility.join(' OR ')})`);
    const ftsQuery = words.map((word) => `"${word.replace(/"/g, '""')}"*`).join(' OR ');
    const rows = this.db ? this.db.prepare(`SELECT m.* FROM memories m JOIN memories_fts ON memories_fts.id = m.id WHERE ${clauses.join(' AND ')} AND memories_fts MATCH ? ORDER BY m.pinned DESC, bm25(memories_fts), m.updated_at DESC LIMIT ?`).all(...params, ftsQuery, Math.min(Math.max(query.limit ?? 8, 1), 30)).map((row) => this.entry(row as Record<string, unknown>)) : this.fallback.memories.filter((entry) => !entry.contradictedBy && ((query.agentId && entry.scope === 'agent' && entry.ownerId === query.agentId) || (query.includeFounder !== false && entry.scope === 'founder') || (query.includeCompany !== false && entry.scope === 'company') || (query.projectId && entry.scope === 'project' && entry.projectId === query.projectId)) && words.some((word) => entry.content.toLowerCase().includes(word.toLowerCase()))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.min(Math.max(query.limit ?? 8, 1), 30));
    let remaining = Math.min(Math.max(query.budgetChars ?? 5_000, 100), 12_000); const hits: MemoryHit[] = [];
    for (const entry of rows) { if (entry.content.length > remaining) continue; remaining -= entry.content.length; entry.lastUsedAt = now(); if (this.db) this.db.prepare('UPDATE memories SET last_used_at=? WHERE id=?').run(entry.lastUsedAt, entry.id); else this.saveFallback(); hits.push({ ...entry, score: (entry.pinned ? 100 : 0) + words.filter((word) => entry.content.toLowerCase().includes(word.toLowerCase())).length }); }
    return hits.sort((a, b) => b.score - a.score);
  }
  preTurn(query: MemoryQuery): { label: string; content: string; source: string }[] { return this.retrieve(query).map((hit) => ({ label: `${hit.scope} memory`, content: hit.content, source: hit.source })); }
  recordSessionTurn(agentId: string, sessionId: string, turn: unknown): void { const safeAgent = clean(agentId, 80); const safeSession = clean(sessionId, 120); if (!safeAgent || !safeSession) return; const path = join(this.root, 'sessions', safeAgent, `${safeSession}.jsonl`); mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify({ ts: now(), turn })}\n`); }
  supersede(oldId: string, replacement: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): { ok: boolean; error?: string; entry?: MemoryEntry } { const old = this.db ? this.db.prepare('SELECT id FROM memories WHERE id=?').get(oldId) : this.fallback.memories.find((entry) => entry.id === oldId); if (!old) return { ok: false, error: 'memory to supersede not found' }; const result = this.write({ ...replacement, supersedes: oldId }); if (!result.ok || !result.entry) return result; if (this.db) { this.db.prepare('UPDATE memories SET contradicted_by=?, updated_at=? WHERE id=?').run(result.entry.id, now(), oldId); } else { const prior = this.fallback.memories.find((entry) => entry.id === oldId)!; prior.contradictedBy = result.entry.id; prior.updatedAt = now(); this.saveFallback(); } return result; }
  private entry(row: Record<string, unknown>): MemoryEntry { return { id: String(row.id), scope: row.scope as MemoryScope, ownerId: row.owner_id as string | undefined, projectId: row.project_id as string | undefined, content: String(row.content), source: String(row.source), confidence: Number(row.confidence), pinned: Boolean(row.pinned), createdAt: String(row.created_at), updatedAt: String(row.updated_at), lastUsedAt: row.last_used_at as string | undefined, supersedes: row.supersedes as string | undefined, contradictedBy: row.contradicted_by as string | undefined }; }
  private candidate(row: Record<string, unknown>): MemoryCandidate { return { id: String(row.id), scope: row.scope as MemoryCandidate['scope'], ownerId: row.owner_id as string | undefined, projectId: row.project_id as string | undefined, content: String(row.content), reason: String(row.reason), confidence: Number(row.confidence), source: String(row.source), status: row.status as MemoryCandidate['status'], createdAt: String(row.created_at) }; }
  private writeMirror(entry: MemoryEntry): void { const part = entry.scope === 'agent' ? join('agents', entry.ownerId ?? 'unknown', 'MEMORY.md') : entry.scope === 'founder' ? join('user', 'USER.md') : entry.scope === 'project' ? join('projects', entry.projectId ?? 'unknown', 'PROJECT.md') : entry.scope === 'company' ? join('company', 'COMPANY.md') : join('sessions', entry.ownerId ?? 'unknown', 'MEMORY.md'); const path = join(this.root, part); mkdirSync(dirname(path), { recursive: true }); const header = `<!-- OrganAIsation Memory V2 mirror; canonical index: index.sqlite -->\n`; const line = `\n- ${entry.content} _(source: ${entry.source}; updated: ${entry.updatedAt})_\n`; try { appendFileSync(path, existsSync(path) ? line : header + line); } catch { /* the SQLite index remains canonical */ } }
  private saveFallback(): void { try { writeFileSync(this.fallbackPath, JSON.stringify(this.fallback, null, 2)); } catch { /* lower durability than SQLite only when native module is unavailable */ } }
}
