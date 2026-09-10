/** Renderer-neutral contract for the OrganAIsation engine. Electron IPC is one
 * adapter; a later professional shell can implement this client over another
 * transport without importing any pixel-office module. */
export interface OrganisationClient {
  fleet: { list(): Promise<unknown> };
  tasks: { list(): Promise<unknown> };
  approvals: { list(): Promise<unknown> };
  memory: { retrieve(query: unknown): Promise<unknown>; propose(candidate: unknown): Promise<unknown> };
  skills: { metadata(): Promise<unknown>; load(id: string): Promise<unknown>; propose(proposal: unknown): Promise<unknown> };
  plugins: { list(): Promise<unknown>; enable(id: string, reviewedHighRisk: boolean): Promise<unknown>; disable(id: string): Promise<unknown> };
  telemetry: { snapshot(): Promise<unknown> };
  messages: { list(): Promise<unknown> };
}
