import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

export const PLUGIN_SPEC_V1 = 'organaisation/plugin@1';
export type PluginState = 'staged' | 'reviewed' | 'installed' | 'enabled' | 'disabled' | 'failed';
export type PluginPermission =
  | 'storage.plugin.read' | 'storage.plugin.write' | 'workspace.read' | 'workspace.write'
  | 'network.fetch' | 'process.spawn' | 'filesystem.read' | 'filesystem.write' | 'secrets.use'
  | 'ui.register' | 'jobs.schedule' | 'memory.read' | 'memory.write' | 'skills.read'
  | 'skills.propose' | 'plugins.propose';

export interface PluginManifest {
  spec: typeof PLUGIN_SPEC_V1;
  id: string;
  name: string;
  version: string;
  description: string;
  entry: string;
  permissions: PluginPermission[];
  contributes: Record<string, string[]>;
}

export interface OrgEvent<T = unknown> { id: string; type: string; ts: number; actorId?: string; pluginId?: string; correlationId?: string; payload: T; }
export interface PluginRecord { manifest: PluginManifest; state: PluginState; installedAt?: string; enabledAt?: string; lastError?: string; approvedAt?: string; health?: { ok: boolean; detail?: string; checkedAt: string }; }
export interface RegisteredTool { id: string; description?: string; pluginId: string; run: (input: unknown) => Promise<unknown> | unknown; }

const HIGH_RISK = new Set<PluginPermission>(['process.spawn', 'filesystem.read', 'filesystem.write', 'secrets.use', 'workspace.write', 'network.fetch']);
const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validatePluginManifest(raw: unknown): { ok: true; manifest: PluginManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'manifest must be an object' };
  const value = raw as Record<string, unknown>;
  if (value.spec !== PLUGIN_SPEC_V1) return { ok: false, error: `expected ${PLUGIN_SPEC_V1}` };
  if (typeof value.id !== 'string' || !ID_RE.test(value.id) || value.id.length > 120) return { ok: false, error: 'invalid plugin id' };
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) return { ok: false, error: 'invalid plugin name' };
  if (typeof value.version !== 'string' || !VERSION_RE.test(value.version)) return { ok: false, error: 'invalid semantic version' };
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.length > 500) return { ok: false, error: 'invalid description' };
  if (typeof value.entry !== 'string' || !value.entry || value.entry.includes('..') || !/\.c?js$/.test(value.entry)) return { ok: false, error: 'entry must be a relative CommonJS JavaScript file' };
  if (!Array.isArray(value.permissions) || value.permissions.some((p) => typeof p !== 'string') || new Set(value.permissions).size !== value.permissions.length) return { ok: false, error: 'permissions must be a unique string array' };
  const allowed = new Set<PluginPermission>(['storage.plugin.read', 'storage.plugin.write', 'workspace.read', 'workspace.write', 'network.fetch', 'process.spawn', 'filesystem.read', 'filesystem.write', 'secrets.use', 'ui.register', 'jobs.schedule', 'memory.read', 'memory.write', 'skills.read', 'skills.propose', 'plugins.propose']);
  if ((value.permissions as string[]).some((p) => !allowed.has(p as PluginPermission))) return { ok: false, error: 'manifest requests an unknown permission' };
  const contributes = value.contributes;
  if (!contributes || typeof contributes !== 'object' || Array.isArray(contributes) || Object.values(contributes as Record<string, unknown>).some((v) => !Array.isArray(v) || v.some((x) => typeof x !== 'string'))) return { ok: false, error: 'contributes must map contribution types to string arrays' };
  return { ok: true, manifest: { spec: PLUGIN_SPEC_V1, id: value.id, name: value.name.trim(), version: value.version, description: value.description.trim(), entry: value.entry, permissions: value.permissions as PluginPermission[], contributes: contributes as Record<string, string[]> } };
}

class EventBus {
  private handlers = new Map<string, Set<(event: OrgEvent) => void>>();
  on(type: string, handler: (event: OrgEvent) => void): () => void { const set = this.handlers.get(type) ?? new Set(); set.add(handler); this.handlers.set(type, set); return () => set.delete(handler); }
  emit(event: OrgEvent): void { for (const handler of this.handlers.get(event.type) ?? []) { try { handler(event); } catch { /* plugin listeners are isolated */ } } }
}

export class PluginRuntime {
  private records = new Map<string, PluginRecord>();
  private active = new Map<string, { deactivate?: () => Promise<void> | void }>();
  private tools = new Map<string, RegisteredTool>();
  private subscriptions = new Map<string, Set<() => void>>();
  private readonly events = new EventBus();
  private readonly statePath: string;
  private readonly pluginsDir: string;

  constructor(private readonly root: string, private readonly hooks: { memory?: { search: (query: string) => unknown; write: (entry: unknown) => unknown }; skills?: { metadata: () => unknown; propose: (proposal: unknown) => unknown } } = {}) {
    this.pluginsDir = join(root, 'plugins'); this.statePath = join(root, 'plugins.json'); mkdirSync(this.pluginsDir, { recursive: true }); this.load();
  }
  list(): PluginRecord[] { return [...this.records.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)); }
  permissionReview(id: string): { permissions: PluginPermission[]; highRisk: PluginPermission[] } | null { const record = this.records.get(id); return record ? { permissions: record.manifest.permissions, highRisk: record.manifest.permissions.filter((p) => HIGH_RISK.has(p)) } : null; }
  discover(stagePath: string): { ok: boolean; record?: PluginRecord; error?: string } {
    try {
      const source = resolve(stagePath); const manifestFile = join(source, 'plugin.json'); if (!existsSync(manifestFile)) return { ok: false, error: 'plugin.json is required' };
      const parsed = validatePluginManifest(JSON.parse(readFileSync(manifestFile, 'utf8'))); if (!parsed.ok) return parsed;
      if (this.records.has(parsed.manifest.id)) return { ok: false, error: 'plugin id already exists' };
      const record: PluginRecord = { manifest: parsed.manifest, state: 'staged' }; this.records.set(parsed.manifest.id, record); this.persist(); return { ok: true, record };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  approve(id: string): { ok: boolean; error?: string } { const record = this.records.get(id); if (!record || record.state !== 'staged') return { ok: false, error: 'only staged plugins can be approved' }; record.state = 'reviewed'; record.approvedAt = new Date().toISOString(); this.persist(); return { ok: true }; }
  install(id: string, stagePath: string): { ok: boolean; error?: string } {
    const record = this.records.get(id); if (!record || record.state !== 'reviewed') return { ok: false, error: 'plugin must be human-reviewed before install' };
    try {
      const source = resolve(stagePath); const manifestPath = join(source, 'plugin.json');
      if (!existsSync(manifestPath)) return { ok: false, error: 'staged plugin files are missing' };
      const staged = validatePluginManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
      if (!staged.ok) return staged;
      if (JSON.stringify(staged.manifest) !== JSON.stringify(record.manifest)) return { ok: false, error: 'plugin manifest changed after review; discover and review it again' };
      const destination = join(this.pluginsDir, id); rmSync(destination, { recursive: true, force: true }); cpSync(source, destination, { recursive: true, filter: (candidate) => !candidate.includes(`${sep}node_modules${sep}`) }); record.state = 'installed'; record.installedAt = new Date().toISOString(); this.persist(); return { ok: true };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  }
  async enable(id: string, confirmation: { reviewedHighRisk: boolean }): Promise<{ ok: boolean; error?: string }> {
    const record = this.records.get(id); if (!record || !['installed', 'disabled', 'failed'].includes(record.state)) return { ok: false, error: 'plugin is not installed' };
    if (record.manifest.permissions.some((p) => HIGH_RISK.has(p)) && !confirmation.reviewedHighRisk) return { ok: false, error: 'high-risk permissions require explicit review' };
    const entry = resolve(join(this.pluginsDir, id, record.manifest.entry)); const pluginRoot = resolve(join(this.pluginsDir, id));
    if (!entry.startsWith(pluginRoot + sep) || !existsSync(entry)) return this.fail(record, 'plugin entry is missing');
    try {
      // The v1 SDK deliberately loads CommonJS entrypoints. This keeps plugin
      // loading deterministic in Electron's bundled main process and avoids
      // granting a plugin a custom ESM loader or arbitrary resolver hooks.
      const module = createRequire(join(pluginRoot, 'plugin.json'))(entry); const plugin = module.default ?? module;
      if (!plugin || typeof plugin.activate !== 'function') return this.fail(record, 'plugin must export activate(context)');
      await plugin.activate(this.context(record)); this.active.set(id, plugin); record.state = 'enabled'; record.enabledAt = new Date().toISOString(); record.lastError = undefined; this.persist(); this.emit('plugin.enabled', { id }); return { ok: true };
    } catch (error) { return this.fail(record, error instanceof Error ? error.message : String(error)); }
  }
  async disable(id: string): Promise<{ ok: boolean; error?: string }> { const record = this.records.get(id); if (!record) return { ok: false, error: 'unknown plugin' }; try { await this.active.get(id)?.deactivate?.(); } catch { /* deactivation may not block containment */ } this.removeContributions(id); this.removeSubscriptions(id); this.active.delete(id); record.state = 'disabled'; this.persist(); this.emit('plugin.disabled', { id }); return { ok: true }; }
  async uninstall(id: string): Promise<{ ok: boolean; error?: string }> { const record = this.records.get(id); if (!record) return { ok: false, error: 'unknown plugin' }; await this.disable(id); try { rmSync(join(this.pluginsDir, id), { recursive: true, force: true }); this.records.delete(id); this.persist(); this.emit('plugin.uninstalled', { id }); return { ok: true }; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; } }
  async health(id: string): Promise<PluginRecord['health'] | null> { const record = this.records.get(id); if (!record) return null; try { const plugin = this.active.get(id) as { health?: () => Promise<{ ok: boolean; detail?: string }> | { ok: boolean; detail?: string } } | undefined; const result = plugin?.health ? await plugin.health() : { ok: record.state === 'enabled', detail: record.state === 'enabled' ? 'active' : record.state }; record.health = { ...result, checkedAt: new Date().toISOString() }; this.persist(); return record.health; } catch (error) { record.health = { ok: false, detail: error instanceof Error ? error.message : String(error), checkedAt: new Date().toISOString() }; this.persist(); return record.health; } }
  /** Restore only plugins that a human previously enabled. A startup failure is
   * contained to the one plugin and records `failed`; it never stops the hive. */
  async restoreEnabled(): Promise<void> {
    for (const record of this.list().filter((candidate) => candidate.state === 'enabled')) {
      record.state = 'installed';
      await this.enable(record.manifest.id, { reviewedHighRisk: true });
    }
  }
  emit(type: string, payload: unknown, actorId?: string): void { this.events.emit({ id: randomUUID(), type, ts: Date.now(), actorId, payload }); }
  toolList(): Omit<RegisteredTool, 'run'>[] { return [...this.tools.values()].map(({ run: _run, ...tool }) => tool); }
  async invokeTool(id: string, input: unknown): Promise<unknown> { const tool = this.tools.get(id); if (!tool) throw new Error('unknown plugin tool'); return tool.run(input); }
  private context(record: PluginRecord) {
    const granted = new Set(record.manifest.permissions); const requirePermission = (permission: PluginPermission) => { if (!granted.has(permission)) throw new Error(`plugin ${record.manifest.id} lacks ${permission}`); };
    return { pluginId: record.manifest.id, dataDir: this.dataDir(record.manifest.id), permissions: { has: (permission: PluginPermission) => granted.has(permission), require: requirePermission }, events: { on: (type: string, handler: (event: OrgEvent) => void) => { const dispose = this.events.on(type, handler); const subscriptions = this.subscriptions.get(record.manifest.id) ?? new Set(); subscriptions.add(dispose); this.subscriptions.set(record.manifest.id, subscriptions); return dispose; }, emit: (type: string, payload: unknown) => this.emit(type, payload) }, tools: { register: (tool: Omit<RegisteredTool, 'pluginId'>) => { if (!/^[a-z0-9_.-]+$/i.test(tool.id)) throw new Error('invalid tool id'); if (this.tools.has(tool.id)) throw new Error('tool id already registered'); this.tools.set(tool.id, { ...tool, pluginId: record.manifest.id }); } }, memory: { search: (query: string) => { requirePermission('memory.read'); return this.hooks.memory?.search(query) ?? []; }, write: (entry: unknown) => { requirePermission('memory.write'); return this.hooks.memory?.write(entry); } }, skills: { metadata: () => { requirePermission('skills.read'); return this.hooks.skills?.metadata() ?? []; }, propose: (proposal: unknown) => { requirePermission('skills.propose'); return this.hooks.skills?.propose(proposal); } }, logger: { info: (...args: unknown[]) => console.info(`[plugin:${record.manifest.id}]`, ...args), warn: (...args: unknown[]) => console.warn(`[plugin:${record.manifest.id}]`, ...args), error: (...args: unknown[]) => console.error(`[plugin:${record.manifest.id}]`, ...args) } };
  }
  private dataDir(id: string): string { const path = join(this.root, 'data', id); mkdirSync(path, { recursive: true }); return path; }
  private removeContributions(id: string): void { for (const [toolId, tool] of this.tools) if (tool.pluginId === id) this.tools.delete(toolId); }
  private removeSubscriptions(id: string): void { for (const dispose of this.subscriptions.get(id) ?? []) { try { dispose(); } catch { /* cleanup is best-effort */ } } this.subscriptions.delete(id); }
  private fail(record: PluginRecord, error: string): { ok: false; error: string } { this.removeContributions(record.manifest.id); this.removeSubscriptions(record.manifest.id); this.active.delete(record.manifest.id); record.state = 'failed'; record.lastError = error.slice(0, 1000); this.persist(); this.emit('plugin.failed', { id: record.manifest.id, error: record.lastError }); return { ok: false, error: record.lastError }; }
  private load(): void { try { const values = JSON.parse(readFileSync(this.statePath, 'utf8')); if (Array.isArray(values)) for (const record of values) { const parsed = validatePluginManifest(record?.manifest); if (parsed.ok && typeof record.state === 'string') this.records.set(parsed.manifest.id, { ...record, manifest: parsed.manifest }); } } catch { /* first start or corrupt metadata: no executable is loaded */ } }
  private persist(): void { mkdirSync(dirname(this.statePath), { recursive: true }); const temporary = `${this.statePath}.tmp`; writeFileSync(temporary, JSON.stringify(this.list(), null, 2)); renameSync(temporary, this.statePath); }
}
