import {createParser} from '../vendor/eventsource-parser/index.js';
import {readModelText} from './model-adapter.mjs';
export const MAX_MODEL_TEXT=2*1024*1024;
export function streamError(code) { const error=new Error('Model stream '+code);error.code=code;return error; }
function providerError(error) {
  const type=error?.type ?? error?.code;
  const status={authentication_error:401,permission_error:403,rate_limit_error:429,rate_limit_exceeded:429,overloaded_error:529}[type];
  const value=streamError('provider');if(status)value.status=status;return value;
}
export function createModelStream(protocol,{onText=()=>{}}={}) {
  let complete=false,text='',failure=null,received=false;
  const parts=new Map();
  function update(key,value,append=true) {
    if (typeof value!=='string' || !value)return;
    parts.set(key,(append ? parts.get(key) ?? '' : '')+value);
    const next=[...parts].sort(([a],[b]) => {const x=String(a).split(':').map(Number),y=String(b).split(':').map(Number);return x[0]-y[0] || (x[1] ?? 0)-(y[1] ?? 0);}).map(([,part])=>part).join('');
    if(next.length>MAX_MODEL_TEXT)throw streamError('too-large');
    if(next!==text){text=next;onText(text);}
  }
  const parser=createParser({maxBufferSize:MAX_MODEL_TEXT,onError(error){if(error.type==='max-buffer-size-exceeded')failure=streamError('too-large');},onEvent(event) {
    if(failure)return;
    received=true;
    try {
      if(event.data==='[DONE]') {if(protocol==='chat')complete=true;return;}
      let data;try{data=JSON.parse(event.data);}catch{throw streamError('invalid-event');}
      const type=data.type ?? event.event;
      if(type==='error' || data.error)throw providerError(data.error ?? data);
      if(complete)return;
      if(protocol==='chat') {
        const choice=data.choices?.find(c => (c.index ?? 0)===0);
        const content=choice?.delta?.content;
        update(0,typeof content==='string' ? content : Array.isArray(content) ? content.filter(p => p.type==='text').map(p=>p.text ?? '').join('') : '');
        if(choice?.finish_reason) {
          if(choice.finish_reason!=='stop')throw streamError('incomplete');
          complete=true;
        }
      } else if(protocol==='responses') {
        const key=(data.output_index ?? 0)+':'+(data.content_index ?? 0);
        if(type==='response.output_text.delta')update(key,data.delta);
        if(type==='response.output_text.done' && !parts.has(key))update(key,data.text,false);
        if(type==='response.failed')throw providerError(data.response?.error);
        if(type==='response.incomplete')throw streamError('incomplete');
        if(type==='response.completed') {
          if(data.response?.status && data.response.status!=='completed')throw streamError('incomplete');
          // The completed snapshot is authoritative but must not be appended
          // a second time after output_text.delta/output_text.done.
          try {const final=readModelText(protocol,data.response);parts.clear();update('final',final,false);}catch(error){if(error.code)throw error;}
          complete=true;
        }
      } else if(protocol==='anthropic') {
        if(type==='content_block_start' && data.content_block?.type==='text')update(data.index ?? 0,data.content_block.text);
        if(type==='content_block_delta' && data.delta?.type==='text_delta')update(data.index ?? 0,data.delta.text);
        if(type==='message_delta' && data.delta?.stop_reason && !['end_turn','stop_sequence'].includes(data.delta.stop_reason))throw streamError('incomplete');
        if(type==='message_stop')complete=true;
      } else throw streamError('protocol');
    } catch(error) {failure=error.code ? error : streamError('invalid-event');}
  }});
  return {
    feed(chunk) {try{parser.feed(chunk);}catch{failure ??=streamError('too-large');}if(failure)throw failure;},
    finish() {if(failure)throw failure;if(!received || !complete)throw streamError('incomplete');if(!text.trim())throw streamError('empty');return text.trim();},
    get text(){return text;},get complete(){return complete;}
  };
}
// Uses Zotero's native anonymous HTTP stack, not fetch/EventSource in the
// privileged panel. Accept a JSON-only relay response without a second POST.
export async function requestModel(http,built,protocol,{onText,setCancel,isCancelled=()=>false,probe=false}={}) {
  let offset=0,mode=null,failure=null;
  const stream=createModelStream(protocol,{onText:text=>{if(!isCancelled())onText?.(text);}});
  function consume(xhr) {
    if(isCancelled() || failure)return;
    if(xhr.status<200 || xhr.status>=300)return;
    const raw=xhr.responseText ?? '';
    if(raw.length>MAX_MODEL_TEXT*8)throw streamError('too-large');
    if(!mode) {
      const contentType=xhr.getResponseHeader?.('Content-Type') ?? '';
      if(contentType.includes('text/event-stream')) mode='sse';
      else if(contentType.includes('json'))mode='json';
      else if(/^\s*\uFEFF?(?:data:|event:|:|id:)/.test(raw))mode='sse';
      else if(/^\s*[\[{]/.test(raw))mode='json';
    }
    if(mode==='sse' && raw.length>offset){const chunk=raw.slice(offset);offset=raw.length;stream.feed(chunk);}
  }
  try {
    const xhr=await http.request('POST',built.endpoint,{
      body:JSON.stringify(built.body),headers:{...built.headers,Accept:probe ? 'application/json' : 'text/event-stream, application/json'},
      responseType:'text',timeout:180000,anon:true,debug:false,followRedirects:false,logBodyLength:0,
      errorDelayMax:0,noRetryOnThrottle:true,successCodes:false,
      cancellerReceiver:cancel=>{setCancel?.(cancel);if(isCancelled())cancel();},
      requestObserver:request=>{
        request.overrideMimeType?.('text/plain; charset=UTF-8');
        request.addEventListener('progress',()=>{try{consume(request);}catch(error){failure=error;request.abort();}});
      }
    });
    if(isCancelled())throw streamError('cancelled');
    if(failure)throw failure;
    if(xhr.status<200 || xhr.status>=300)throw {status:xhr.status};
    consume(xhr);
    if(mode==='sse')return stream.finish();
    let data;try{data=JSON.parse(xhr.responseText);}catch{throw streamError('invalid-response');}
    if(data.error)throw providerError(data.error);
    if(data.status && data.status!=='completed')throw streamError('incomplete');
    const reason=protocol==='chat' ? data.choices?.[0]?.finish_reason : protocol==='anthropic' ? data.stop_reason : null;
    if(reason && !['stop','end_turn','stop_sequence'].includes(reason))throw streamError('incomplete');
    const answer=readModelText(protocol,data);if(answer.length>MAX_MODEL_TEXT)throw streamError('too-large');
    onText?.(answer);return answer;
  } catch(error) {
    if(isCancelled())throw streamError('cancelled');
    throw failure ?? error;
  } finally {setCancel?.(null);}
}
