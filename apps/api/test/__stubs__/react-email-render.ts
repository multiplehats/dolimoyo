// Stub for @react-email/render — used only in the worker test bundle.
// The real render() uses react-dom/server.edge which is not available under
// Cloudflare Workers module conditions. Tests that exercise email rendering
// should run in the Node pipeline project instead.
export async function render(_element: unknown, _options?: unknown): Promise<string> {
  throw new Error('[test stub] @react-email/render is not available in worker tests')
}
