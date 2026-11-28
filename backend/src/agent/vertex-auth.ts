import { GoogleAuth } from 'google-auth-library';
import { ModelFailure } from './model-errors.js';

const auth = new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
// ADC uses the attached service identity in Cloud Run and the gcloud ADC login
// on the developer Mac. Google's library owns refresh; credentials stay server-side.
export async function vertexAccessToken(signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const token=await auth.getAccessToken().catch(()=>{throw new ModelFailure('identity');});
  signal.throwIfAborted();
  if(!token)throw new ModelFailure('identity');
  return token;
}

export const VERTEX_ASSISTANT_MODEL = 'gemini-3.8-flash';
const VERTEX_CAMPUS_SCENE_MODEL = 'gemini-3.1-flash-lite';

function vertexConnection() {
  const project = process.env.AGENT_GOOGLE_PROJECT;
  const location = process.env.AGENT_GOOGLE_LOCATION ?? 'global';
  if (!project || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || location !== 'global') {
    throw new Error('Cloud AI requires the approved project and global region.');
  }
  if (process.env.AGENT_BASE_URL || process.env.AGENT_API_KEY) throw new Error('Vertex AI uses its service identity, not a custom endpoint or API key.');
  return { project, location, base: `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google` };
}

export function vertexSettings() {
  const model = process.env.AGENT_MODEL;
  if (model !== VERTEX_ASSISTANT_MODEL && model !== VERTEX_CAMPUS_SCENE_MODEL) {
    throw new Error('Cloud AI requires an approved Assistant model.');
  }
  return { ...vertexConnection(), model };
}

export function campusSceneVertexSettings() {
  return { ...vertexConnection(), model: VERTEX_CAMPUS_SCENE_MODEL };
}
