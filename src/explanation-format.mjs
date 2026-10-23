import {jsonrepair} from '../vendor/jsonrepair/index.js';

// KaTeX 0.19's n-prefixed commands. In JSON, \n followed by ordinary text
// (\nS, \nwhere) is a newline, while an under-escaped \nu must stay TeX.
const nCommands=new Set(('nLeftarrow nLeftrightarrow nRightarrow nVDash nVdash nabla natnums natural ncong ne nearrow neg negmedspace negthickspace negthinspace neq newcommand newline nexists ngeq ngeqq ngeqslant ngtr ni nleftarrow nleftrightarrow nleq nleqq nleqslant nless nmid nobreak nobreakspace noexpand nolimits nonumber normalsize not notag notin notni nparallel nprec npreceq nrightarrow nshortmid nshortparallel nsim nsubseteq nsubseteqq nsucc nsucceq nsupseteq nsupseteqq ntriangleleft ntrianglelefteq ntriangleright ntrianglerighteq nu nvDash nvdash nwarrow').split(' '));

// Decode an envelope independently from the Markdown it contains. A blanket
// slash-n replacement would damage code snippets, paths and LaTeX commands.
function unwrap(text) {
  let raw=String(text ?? '').trim();
  raw=raw.replace(/^```(?:json)?\s*\n?/i,'').replace(/\s*```$/,'');
  for (let i=0;i<2 && raw.startsWith('"');i++) {
    try { const value=JSON.parse(raw); if (typeof value !== 'string') break; raw=value.trim(); }
    catch {
      // A double-encoded relay may still be streaming its outer JSON string.
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
    const word=raw.slice(end).match(/^[A-Za-z]+/)?.[0] ?? '';
    const texCommand=word.length>1 && (next!=='n' || nCommands.has(word));
    // Protect even JSON-valid prefixes like \theta and \frac, but let JSON
    // decode its actual newline escapes within display math.
    if (count%2 && next && (math && texCommand || !/["\\/bfnrtu]/.test(next))) count++;
    out+='\\'.repeat(count);i=end-1;
    if (next===math) math=null;
  }
  return out;
}
// Some relays emit unescaped quotes inside these two recognized string fields.
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
function decodeMarkdownWrapper(raw) {
  let value=raw;
  for(let i=0;i<2 && value.startsWith('"');i++) {
    try {const decoded=JSON.parse(value);if(typeof decoded!=='string')break;value=decoded.trim();}
    catch {break;}
  }
  // Ordinary quoted phrases and Markdown code fences are not JSON wrappers.
  return /\n|\\(?:r\\)?n\\(?:r\\)?n/.test(value) ? value : raw;
}
function restoreModelNewlines(raw) {
  const breaks=[];
  for(let i=0;i<raw.length;) {
    const char=raw[i];
    if(char==='`' || char==='~' && raw.startsWith('~~~',i)) {
      const delimiter=raw.slice(i).match(char==='`' ? /^`+/ : /^~+/)[0];
      let end=raw.indexOf(delimiter,i+delimiter.length);
      while(end>=0 && (raw[end-1]===char || raw[end+delimiter.length]===char))end=raw.indexOf(delimiter,end+delimiter.length);
      if(end>=0) {i=end+delimiter.length;continue;}
      if(delimiter.length>=3)break; // Keep an incomplete streaming code block intact.
      i+=delimiter.length;continue;
    }
    if(char==='\\' || /[A-Za-z]/.test(char) && raw[i+1]===':' && raw[i+2]==='\\') {
      const path=raw.slice(i).match(/^(?:[A-Za-z]:\\|\\\\[^\\\s]+\\)[^\s<>"`|，。！？；：]*/)?.[0];
      if(path) {i+=path.length;continue;}
    }
    if(char!=='\\') {i++;continue;}
    let end=i;while(raw[end]==='\\')end++;
    if(end-i!==1) {i=end;continue;}
    const word=raw.slice(end).match(/^[A-Za-z]+/)?.[0];
    const size=raw.startsWith('\\r\\n',i) ? 4 : raw[end]==='n' && !nCommands.has(word) ? 2 : 0;
    // A literal escape followed by sentence punctuation is an example, not a
    // paragraph break. Inline code and Windows/UNC paths were skipped above.
    if(size && !/[，。！？；：、,.!?;:'")\]}]/.test(raw[i+size] ?? ''))breaks.push({start:i,end:i+size});
    i+=size || 1;
  }
  // Recover an extra escaping layer only with visible Markdown layout evidence.
  const layout=breaks.some((entry,index)=>{
    const next=breaks[index+1];
    return next && /^\s*$/.test(raw.slice(entry.end,next.start)) ||
      /^[ \t]{0,3}(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s|`{3}|~{3}|\$\$)/.test(raw.slice(entry.end)) ||
      /(?:^|\n)[ \t]{0,3}#{1,6}\s[^\n]*$|\$\$$/.test(raw.slice(0,entry.start));
  });
  if(!layout)return raw;
  let result='',start=0;
  for(const entry of breaks) {result+=raw.slice(start,entry.start)+'\n';start=entry.end;}
  return result+raw.slice(start);
}
const markdown=text=>restoreModelNewlines(decodeMarkdownWrapper(String(text ?? '').trim()));
export function parseExplanation(text,{partial=false}={}) {
  const raw=String(text ?? '').trim();
  const parsed=structured(raw);
  if (parsed && (partial || typeof parsed.summary==='string' && parsed.summary.trim() && typeof parsed.detail==='string' && parsed.detail.trim())) {
    return {summary:typeof parsed.summary==='string' ? markdown(parsed.summary) : '',detail:typeof parsed.detail==='string' ? markdown(parsed.detail) : '',format:'markdown'};
  }
  const decoded=decodeMarkdownWrapper(raw);
  // An incomplete JSON header must never flash as raw JSON while streaming.
  if (partial && decoded===raw && (/^(?:```(?:json)?\s*)?\s*[\{"]/.test(raw) || /^`{1,3}(?:j(?:s(?:o(?:n)?)?)?)?$/i.test(raw))) return {summary:'',detail:'',format:'markdown'};
  const detail=restoreModelNewlines(decoded),first=detail.split(/\n\s*\n/).find(part => part.trim()) ?? detail;
  return {summary:first,detail,format:'markdown'};
}
export function recoverExplanation(explanation) {
  const parsed=structured(explanation?.detail);
  if (typeof parsed?.summary==='string' && parsed.summary.trim() && typeof parsed?.detail==='string' && parsed.detail.trim()) {
    return {summary:markdown(parsed.summary),detail:markdown(parsed.detail),format:'markdown'};
  }
  if(!explanation)return {summary:'',detail:'',format:'markdown'};
  return {...explanation,...typeof explanation.summary==='string' && {summary:markdown(explanation.summary)},...typeof explanation.detail==='string' && {detail:markdown(explanation.detail)}};
}
export function normalizeAnswer(text,{partial=false}={}) {
  const parsed=structured(text);
  if(typeof parsed?.detail==='string')return markdown(parsed.detail);
  const raw=String(text ?? '').trim(),decoded=decodeMarkdownWrapper(raw);
  if(partial && decoded===raw && /^(?:```(?:json)?\s*)?\s*[\{"]/.test(raw))return '';
  return restoreModelNewlines(decoded);
}
