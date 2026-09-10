import { useEffect, useState } from 'react';
import { PixelButton } from './PixelButton';
import { PixelPanel } from './PixelPanel';

type Plugin = { manifest: { id: string; name: string; version: string; permissions: string[] }; state: string; lastError?: string };
type PiBinding = { agentId: string; source: string; enabled: boolean; requestedAt: string };

/** A deliberately small shell over the shared OrganAIsation facade. The office
 * remains the default experience; this panel proves plugins, Pi packages and
 * proposal state are renderer-independent rather than hidden in Pixi state. */
export function OrganisationPanel({ onClose }: { onClose: () => void }) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pi, setPi] = useState<PiBinding[]>([]);
  const [agentId, setAgentId] = useState('');
  const [source, setSource] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = async () => {
    try { setPlugins(await window.cth.organisationPlugins() as Plugin[]); setPi(await window.cth.piPackages() as PiBinding[]); } catch { setNotice('Unable to load OrganAIsation services. Configure a hive first.'); }
  };
  useEffect(() => { void refresh(); }, []);
  const requestPi = async () => { const result = await window.cth.piPackageRequest(agentId, source) as { ok?: boolean; error?: string }; setNotice(result.ok ? 'Pi package requested. Human confirmation is required before it is enabled.' : result.error ?? 'Request failed'); if (result.ok) { setSource(''); void refresh(); } };
  return (
    <div style={{ position: 'absolute', zIndex: 55, top: 14, right: 14, width: 440, maxHeight: 'calc(100% - 28px)', overflow: 'auto' }}>
      <PixelPanel variant="dialog" title="ORGAN AISATION CORE" noPadding>
        <div style={{ padding: 14, display: 'grid', gap: 14, fontSize: 12, lineHeight: 1.45 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>Extensible organization services. Plugin activation and Pi package installation always require human review.</span>
            <PixelButton size="sm" variant="secondary" onClick={onClose}>close</PixelButton>
          </div>
          <section>
            <strong>Application plugins</strong>
            <div style={{ marginTop: 6, display: 'grid', gap: 5 }}>
              {plugins.length === 0 ? <span style={{ color: 'var(--cth-ink-500)' }}>No application plugins installed.</span> : plugins.map((plugin) => <div key={plugin.manifest.id} style={{ padding: 7, background: 'var(--cth-cream-200)' }}><b>{plugin.manifest.name}</b> · {plugin.state}<br /><small>{plugin.manifest.permissions.join(', ') || 'no permissions'}{plugin.lastError ? ` · ${plugin.lastError}` : ''}</small></div>)}
            </div>
          </section>
          <section>
            <strong>Pi packages (agent-scoped, not application plugins)</strong>
            <p style={{ margin: '4px 0 8px', color: 'var(--cth-ink-600)' }}>A Pi package is installed only for the named Pi agent after you confirm it. It does not extend the Munder application.</p>
            <div style={{ display: 'grid', gap: 6 }}>
              <input value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="Pi agent id" />
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Package source" />
              <PixelButton size="sm" variant="primary" onClick={() => void requestPi()} disabled={!agentId.trim() || !source.trim()}>request Pi package</PixelButton>
              {pi.map((item) => <div key={`${item.agentId}:${item.source}`} style={{ padding: 6, background: 'var(--cth-cream-200)' }}>{item.agentId}: {item.source} · {item.enabled ? 'enabled' : 'awaiting confirmation'}</div>)}
            </div>
          </section>
          {notice && <div style={{ color: 'var(--cth-ink-700)' }}>{notice}</div>}
        </div>
      </PixelPanel>
    </div>
  );
}
