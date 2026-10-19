// Read-only compatibility with optional 0.2.4 metadata; no request cache or generation changes.
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every(k=>allowed.includes(k));
const time = v => Number.isFinite(v) && v >= 0;
const token = v => v === null || Number.isSafeInteger(v) && v >= 0;
export const validFingerprint = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export function validGeneration(value) {
  return keys(value,['summary','detail']) && Object.values(value).every(entry=>{
    const m=entry?.metrics;
    return keys(entry,['key','metrics']) && validFingerprint(entry.key) && keys(m,['source','requestId','elapsedMs','firstTextMs','completedAt','usage']) && ['network','cache','shared'].includes(m.source) && typeof m.requestId==='string' && m.requestId.length>0 && m.requestId.length<=128 && time(m.elapsedMs) && (m.firstTextMs===null || time(m.firstTextMs)) && time(m.completedAt) && keys(m.usage,['inputTokens','outputTokens','cachedInputTokens']) && ['inputTokens','outputTokens','cachedInputTokens'].every(k=>token(m.usage[k]));
  });
}
