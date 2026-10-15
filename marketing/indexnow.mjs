import {readFileSync} from 'node:fs';

const key = readFileSync(new URL('./public/ed304ac9e7409dcf016a1d3d61b3abc1.txt', import.meta.url), 'utf8').trim();

export const indexNowUrls = [
  '/',
  '/school-management-software',
  '/school-attendance-management',
  '/school-timetable-software',
  '/parent-communication-app',
  '/ai-assistant-for-schools',
  '/privacy',
  '/terms',
].map(path => `https://thatcampus.com${path}`);

export const indexNowPayload = {
  host: 'thatcampus.com',
  key,
  keyLocation: `https://thatcampus.com/${key}.txt`,
  urlList: indexNowUrls,
};

export async function submitIndexNow(fetchImpl = fetch) {
  const response = await fetchImpl('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: {'content-type': 'application/json; charset=utf-8'},
    body: JSON.stringify(indexNowPayload),
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`IndexNow rejected the canonical URL set: HTTP ${response.status}`);
  }
  return response.status;
}
