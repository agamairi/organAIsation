import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { PluginPermission } from './pluginRuntime';

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

export function proposePluginScaffold(root: string, input: { name: unknown; problem: unknown; requestedPermissions: unknown; targetAgents?: unknown }): { ok: boolean; stagePath?: string; error?: string } {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : ''; const problem = typeof input.problem === 'string' ? input.problem.trim().slice(0, 1_000) : ''; const permissions = Array.isArray(input.requestedPermissions) && input.requestedPermissions.every((p) => typeof p === 'string') ? input.requestedPermissions as PluginPermission[] : [];
  if (!name || !problem) return { ok: false, error: 'name and problem are required' }; const slug = slugify(name); if (!slug) return { ok: false, error: 'name cannot produce a safe plugin slug' };
  const stagePath = resolve(root, slug); if (!stagePath.startsWith(resolve(root) + sep)) return { ok: false, error: 'unsafe stage path' };
  try {
    mkdirSync(join(stagePath, 'src'), { recursive: true }); mkdirSync(join(stagePath, 'tests'), { recursive: true }); mkdirSync(join(stagePath, 'help'), { recursive: true });
    writeFileSync(join(stagePath, 'plugin.json'), JSON.stringify({ spec: 'organaisation/plugin@1', id: `local.${slug}`, name, version: '0.1.0', description: problem, entry: 'src/index.js', permissions, contributes: { tools: [], commands: [], events: [], ui: [], jobs: [], knowledgeSources: [], memoryProviders: [] } }, null, 2));
    writeFileSync(join(stagePath, 'src', 'index.js'), `export function activate(ctx) {\n  // Register only declared, least-privilege capabilities here.\n  ctx.logger.info('staged plugin activated for review self-test');\n}\n\nexport function deactivate() {}\n`);
    writeFileSync(join(stagePath, 'tests', 'plugin.test.js'), `import test from 'node:test';\ntest('plugin scaffold has a manifest', () => {});\n`);
    writeFileSync(join(stagePath, 'help', 'index.md'), `# ${name}\n\n${problem}\n`);
    writeFileSync(join(stagePath, 'README.md'), `# ${name}\n\nStaged OrganAIsation plugin. It is not installed or enabled until a human approves the proposal.\n`);
    writeFileSync(join(stagePath, 'CHANGELOG.md'), '# Changelog\n\n## 0.1.0\n\n- Initial staged proposal.\n');
    writeFileSync(join(stagePath, 'PROPOSAL.md'), `# Plugin proposal: ${name}\n\n## Problem\n${problem}\n\n## Existing capability check\nReview installed plugins, application capabilities, Pi packages (for Pi agents), MCP integrations, and skills before approval.\n\n## Target agents\n${Array.isArray(input.targetAgents) ? input.targetAgents.filter((id) => typeof id === 'string').join(', ') || 'Not specified' : 'Not specified'}\n\n## Requested permissions\n${permissions.map((permission) => `- ${permission}`).join('\n') || '- None'}\n\n## Risks\nPlugin code is isolated from core registration APIs but executes locally after human enablement. Review the source and permissions.\n\n## Tests\nRun \`node --test tests/plugin.test.js\` before installation.\n\n## Rollback\nDisable from the plugin manager, then uninstall; plugin data lives under the plugin data directory.\n`);
    return { ok: true, stagePath };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export interface PiPackageBinding { agentId: string; source: string; enabled: boolean; requestedAt: string; approvedAt?: string; }
export class PiPackageBridge {
  private readonly path: string;
  constructor(root: string) { this.path = join(root, 'pi-packages.json'); }
  list(agentId?: string): PiPackageBinding[] { try { const values = JSON.parse(require('node:fs').readFileSync(this.path, 'utf8')); return Array.isArray(values) ? values.filter((value): value is PiPackageBinding => value && typeof value.agentId === 'string' && typeof value.source === 'string' && (!agentId || value.agentId === agentId)) : []; } catch { return []; } }
  request(agentId: unknown, source: unknown): { ok: boolean; error?: string } { const id = typeof agentId === 'string' ? agentId.trim().slice(0, 80) : ''; const packageSource = typeof source === 'string' ? source.trim().slice(0, 500) : ''; if (!id || !packageSource) return { ok: false, error: 'Pi agent and package source are required' }; const values = this.list(); values.push({ agentId: id, source: packageSource, enabled: false, requestedAt: new Date().toISOString() }); writeFileSync(this.path, JSON.stringify(values, null, 2)); return { ok: true }; }
  confirm(agentId: string, source: string): { ok: boolean; error?: string } { const values = this.list(); const binding = values.find((item) => item.agentId === agentId && item.source === source); if (!binding) return { ok: false, error: 'requested Pi package not found' }; binding.enabled = true; binding.approvedAt = new Date().toISOString(); writeFileSync(this.path, JSON.stringify(values, null, 2)); return { ok: true }; }
}
