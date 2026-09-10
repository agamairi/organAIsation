'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const loadTs = require('./load-ts.cjs');

const { validateOrganisationRoster, rosterProviders } = loadTs('src/shared/organaisation.ts');
const { PluginRuntime } = loadTs('src/main/organai/pluginRuntime.ts');
const { MemoryV2Service } = loadTs('src/main/organai/memoryV2.ts');
const { SkillRuntime } = loadTs('src/main/organai/skillsV2.ts');
const { PiPackageBridge, proposePluginScaffold } = loadTs('src/main/organai/factory.ts');

const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test('roster uses runtime providers and represents Pi without a second allowlist', () => {
  assert.ok(rosterProviders().includes('pi'));
  const result = validateOrganisationRoster({
    spec: 'organaisation/roster@1', name: 'Startup', orchestrator: 'kevin', agents: [{
      id: 'kevin', name: 'Kevin', role: 'Documentation Librarian', goal: 'Keep knowledge accurate.',
      provider: 'pi', capabilities: ['docs', 'knowledge']
    }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.roster.agents[0].provider, 'pi');
});

test('plugin lifecycle is reviewed, permission-gated, isolated, and uninstallable', async () => {
  const root = temp('org-plugin-'); const stage = join(root, 'stage'); mkdirSync(stage, { recursive: true });
  try {
    writeFileSync(join(stage, 'plugin.json'), JSON.stringify({ spec: 'organaisation/plugin@1', id: 'local.hello-tool', name: 'Hello Tool', version: '0.1.0', description: 'A harmless test tool', entry: 'index.js', permissions: ['storage.plugin.write'], contributes: { tools: ['hello'], events: ['hello.event'] } }));
    writeFileSync(join(stage, 'index.js'), `module.exports = { activate(ctx) { ctx.tools.register({ id: 'hello', run: (input) => 'hello ' + input }); ctx.events.on('hello.event', () => ctx.logger.info('heard')); }, deactivate() {} };`);
    const runtime = new PluginRuntime(root);
    assert.equal(runtime.discover(stage).ok, true);
    assert.equal((await runtime.enable('local.hello-tool', { reviewedHighRisk: false })).ok, false, 'staged code cannot auto-enable');
    assert.equal(runtime.approve('local.hello-tool').ok, true);
    assert.equal(runtime.install('local.hello-tool', stage).ok, true);
    const enabled = await runtime.enable('local.hello-tool', { reviewedHighRisk: false });
    assert.equal(enabled.ok, true, enabled.error);
    assert.equal(await runtime.invokeTool('hello', 'world'), 'hello world');
    runtime.emit('hello.event', {});
    assert.equal((await runtime.disable('local.hello-tool')).ok, true);
    assert.equal((await runtime.uninstall('local.hello-tool')).ok, true);
    assert.equal(runtime.list().length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('memory is persisted, scope-filtered, candidate-approved, and superseded', () => {
  const root = temp('org-memory-');
  try {
    const memory = new MemoryV2Service(root);
    const project = memory.write({ scope: 'project', projectId: 'alpha', content: 'Keep the legacy hire schema compatible.', source: 'decision', confidence: 0.9 });
    memory.write({ scope: 'founder', content: 'Prefer compact implementation summaries.', source: 'founder', confidence: 1 });
    assert.equal(memory.retrieve({ query: 'legacy schema', projectId: 'beta' }).some((hit) => hit.projectId === 'alpha'), false);
    assert.equal(memory.retrieve({ query: 'legacy schema', projectId: 'alpha' }).some((hit) => hit.id === project.entry.id), true);
    const candidate = memory.propose({ scope: 'company', content: 'Plugins require human enablement.', reason: 'security policy', source: 'session:test', confidence: 0.95 });
    assert.equal(memory.decideCandidate(candidate.candidate.id, true).ok, true);
    const replacement = memory.supersede(project.entry.id, { scope: 'project', projectId: 'alpha', content: 'Legacy hire@1 remains backward compatible.', source: 'decision update', confidence: 0.95 });
    assert.equal(replacement.ok, true);
    assert.equal(memory.retrieve({ query: 'legacy hire', projectId: 'alpha' }).some((hit) => hit.id === project.entry.id), false);
    memory.close();
    const reopened = new MemoryV2Service(root);
    assert.equal(reopened.retrieve({ query: 'human enablement' }).length > 0, true);
    reopened.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skills require human approval and retain prior versions; Pi packages remain agent-scoped', () => {
  const root = temp('org-skill-');
  try {
    const skills = new SkillRuntime(root);
    const create = skills.propose({ kind: 'create', source: 'session:123', reason: 'Repeated research workflow', skill: { spec: 'organaisation/skill@1', id: 'competitor-research', name: 'Competitor Research', version: '1.0.0', description: 'Research competitors', triggers: ['competitor research'], capabilities: ['research'], scope: 'company' }, body: '# Skill: Competitor Research\n\n## Procedure\n1. Gather sources.\n' });
    assert.equal(skills.metadata().length, 0);
    assert.equal(skills.decide(create.proposal.id, true).ok, true);
    assert.equal(skills.load('competitor-research').meta.version, '1.0.0');
    const update = skills.propose({ kind: 'update', source: 'session:124', reason: 'Add validation', skill: { spec: 'organaisation/skill@1', id: 'competitor-research', name: 'Competitor Research', version: '1.1.0', description: 'Research competitors', triggers: ['competitor research'], capabilities: ['research'], scope: 'company' }, body: '# Skill: Competitor Research\n\n## Validation\n1. Cite sources.\n' });
    assert.equal(skills.decide(update.proposal.id, true).ok, true);
    assert.equal(skills.load('competitor-research').meta.version, '1.1.0');
    assert.equal(readFileSync(join(root, 'skill-history', 'competitor-research', '1.0.0', 'SKILL.md'), 'utf8').includes('Gather sources'), true);
    const pi = new PiPackageBridge(root); assert.equal(pi.request('kevin', 'npm:example-pi-skill').ok, true); assert.equal(pi.list('kevin')[0].enabled, false); assert.equal(pi.confirm('kevin', 'npm:example-pi-skill').ok, true); assert.equal(pi.list('kevin')[0].enabled, true);
    const stage = proposePluginScaffold(join(root, 'staged'), { name: 'Research helper', problem: 'Need a reviewable integration.', requestedPermissions: ['network.fetch'], targetAgents: ['ryan'] });
    assert.equal(stage.ok, true); assert.equal(readFileSync(join(stage.stagePath, 'PROPOSAL.md'), 'utf8').includes('Rollback'), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
