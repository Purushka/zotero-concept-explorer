import {jsonrepair} from '../vendor/jsonrepair/index.js';

// Only repair structured envelopes. Never replace \\n globally in Markdown:
// that would damage code snippets, Windows paths and LaTeX commands.
function unwrap(text) {
  let raw=String(text ?? '').trim();
  raw=raw.replace(/^```(?:json)?\s*\n?/i,'').replace(/\s*```$/,'');
  for (let i=0;i<2 && raw.startsWith('"');i++) {
    try { const value=JSON.parse(raw); if (typeof value !== 'string') break; raw=value.trim(); }
    catch {
      // A double-encoded relay may still be streaming its outer JSON string.
      // Repair that wrapper only; its decoded envelope is parsed below.
      if (!/^"\s*\{/.test(raw)) break;
      try { const value=JSON.parse(jsonrepair(raw)); if(typeof value!=='string')break;raw=value.trim(); }
      catch { break; }
    }
  }
  return raw;
}
function looksStructured(raw) {
  return /^\{\s*(?:["']|\\")?(?:summary|detail)(?:["']|\\")?\s*:/i.test(raw);
}
function protectMathEscapes(raw) {
  let out='',math=null;
  for (let i=0;i<raw.length;i++) {
    const char=raw[i];
    if (char==='$') {
      const marker=raw[i+1]==='$' ? '$$' : '$';
      if (!math) math=marker; else if(math===marker) math=null;
      out+=marker;i+=marker.length-1;continue;
    }
    if (char!=='\\') {out+=char;continue;}
    let end=i;while(raw[end]==='\\')end++;
    let count=end-i;const next=raw[end];
    if (next==='(' || next==='[') math=next==='(' ? ')' : ']';
    // jsonrepair normally removes invalid escapes. Preserve the backslash for
    // math instead, including JSON-valid prefixes like \\theta and \\frac.
    if (count%2 && next && (math && /^[A-Za-z]{2}/.test(raw.slice(end)) || !/["\\/bfnrtu]/.test(next))) count++;
    out+='\\'.repeat(count);i=end-1;
    if (next===math) math=null;
  }
  return out;
}
// A few relays emit unescaped quotes inside these two string fields. Keep the
// repair narrowly scoped to the recognized envelope, then let jsonrepair parse it.
function repairEnvelopeQuotes(raw) {
  return raw.replace(/("(?:summary|detail)"\s*:\s*")([\s\S]*?)(?="\s*,\s*"(?:summary|detail)"\s*:|"\s*\}\s*$|$)/g,(_match,prefix,body) => {
    let escaped='',slashes=0;
    for(const char of body) {
      if(char==='"' && slashes%2===0)escaped+='\\';
      escaped+=char;slashes=char==='\\' ? slashes+1 : 0;
    }
    return prefix+escaped;
  });
}
function structured(text) {
  const raw=unwrap(text);
  if (!looksStructured(raw)) return null;
  const protectedRaw=protectMathEscapes(raw);
  for (const candidate of [protectedRaw,raw]) {
    try {const value=JSON.parse(candidate);if(value && typeof value==='object' && !Array.isArray(value))return value;}catch{}
  }
  for(const candidate of [protectedRaw,repairEnvelopeQuotes(protectedRaw)]) {
    try {return JSON.parse(jsonrepair(candidate));}catch{}
  }
  return null;
}
export function parseExplanation(text,{partial=false}={}) {
  const raw=String(text ?? '').trim();
  const parsed=structured(raw);
  if (parsed && (partial || typeof parsed.summary==='string' && parsed.summary.trim() && typeof parsed.detail==='string' && parsed.detail.trim())) {
    return {summary:typeof parsed.summary==='string' ? parsed.summary.trim() : '',detail:typeof parsed.detail==='string' ? parsed.detail.trim() : '',format:'markdown'};
  }
  // An incomplete JSON header must never flash as raw JSON while streaming.
  if (partial && (/^(?:```(?:json)?\s*)?\s*[\{"]/.test(raw) || /^`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?$/i.test(raw))) return {summary:'',detail:'',format:'markdown'};
  const first=raw.split(/\n\s*\n/).find(part => part.trim()) ?? raw;
  return {summary:first,detail:raw,format:'markdown'};
}
export function recoverExplanation(explanation) {
  const parsed=structured(explanation?.detail);
  if (typeof parsed?.summary==='string' && parsed.summary.trim() && typeof parsed?.detail==='string' && parsed.detail.trim()) {
    return {summary:parsed.summary.trim(),detail:parsed.detail.trim(),format:'markdown'};
  }
  return explanation ?? {summary:'',detail:'',format:'markdown'};
}
export function normalizeAnswer(text,{partial=false}={}) {
  const parsed=structured(text);
  if(typeof parsed?.detail==='string')return parsed.detail.trim();
  if(partial && /^(?:```(?:json)?\s*)?\s*[\{"]/.test(String(text ?? '').trim()))return '';
  return String(text ?? '').trim();
}
