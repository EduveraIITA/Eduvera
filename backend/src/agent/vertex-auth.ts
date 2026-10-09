import { z } from 'zod';

let cached: { token: string; until: number } | undefined;
// Fixed Google metadata destination: no request-controlled URL and no exported key.
export async function vertexAccessToken(signal: AbortSignal): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
  });
  if (!response.ok) throw new Error('The cloud model identity is unavailable.');
  const data = z.object({ access_token: z.string().min(20).max(10000), expires_in: z.number().int().positive().max(7200), token_type: z.literal('Bearer') }).parse(await response.json());
  cached = { token: data.access_token, until: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

export function vertexSettings() {
  const project = process.env.AGENT_GOOGLE_PROJECT;
  const location = process.env.AGENT_GOOGLE_LOCATION ?? 'global';
  const model = process.env.AGENT_MODEL;
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || location !== 'global' || model !== 'gemini-3.1-flash-lite') {
    throw new Error('Cloud AI requires the approved project, global region and Gemini 3.1 Flash-Lite model.');
  }
  if (process.env.AGENT_BASE_URL || process.env.AGENT_API_KEY) throw new Error('Vertex AI uses its service identity, not a custom endpoint or API key.');
  return { project, location, model, base: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google` };
}
