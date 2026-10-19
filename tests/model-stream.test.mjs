import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelStream,requestModel,MAX_MODEL_TEXT} from '../src/model-stream.mjs';
import {buildRequest,friendlyHTTPError} from '../src/model-adapter.mjs';
const event=(data,type) => (type ? 'event: '+type+'\r\n' : '')+'data: '+(typeof data==='string' ? data : JSON.stringify(data))+'\r\n\r\n';
const chat=(content,finish=null) => event({choices:[{index:0,delta:{content},finish_reason:finish}]});
const responses=(type,data={}) => event({type,...data},type);
const anthropic=(type,data={}) => event({type,...data},type);
const split=(stream,text,size=1) => {for(let i=0;i<text.length;i+=size)stream.feed(text.slice(i,i+size));};
test('Chat SSE handles every split, BOM, comments, CRLF, reasoning and usage without duplicates',()=>{
  const updates=[],stream=createModelStream('chat',{onText:t=>updates.push(t)});
  split(stream,'\uFEFF: keepalive\r\n\r\n'+event({choices:[{index:0,delta:{reasoning_content:'not visible'}}]})+chat('概念')+chat('解释')+chat('','stop')+event({choices:[],usage:{}})+event('[DONE]'));
  assert.equal(stream.finish(),'概念解释');assert.deepEqual(updates,['概念','概念解释']);
});
test('Responses deltas ignore reasoning, do not duplicate done/final snapshots and support multipart order',()=>{
  const stream=createModelStream('responses');
  const text=responses('response.reasoning_text.delta',{delta:'private reasoning'})+responses('response.output_text.delta',{output_index:1,content_index:0,delta:'B'})+responses('response.output_text.delta',{output_index:0,content_index:0,delta:'A'})+responses('response.output_text.done',{output_index:0,content_index:0,text:'A'})+responses('response.completed',{response:{status:'completed',output_text:'AB'}});
  split(stream,text,3);assert.equal(stream.finish(),'AB');
});
test('Responses completed snapshot alone supports relays, missing completion never counts as saved',()=>{
  const final=createModelStream('responses');final.feed(responses('response.completed',{response:{status:'completed',output_text:'final'}}));assert.equal(final.finish(),'final');
  const partial=createModelStream('responses');partial.feed(responses('response.output_text.done',{text:'not complete'}));assert.throws(()=>partial.finish(),{code:'incomplete'});
});
test('Anthropic text blocks stream but tool/thinking/ping blocks never become visible answers',()=>{
  const stream=createModelStream('anthropic');
  split(stream,anthropic('message_start')+anthropic('ping')+anthropic('content_block_start',{index:0,content_block:{type:'thinking',thinking:'secret'}})+anthropic('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'secret'}})+anthropic('content_block_start',{index:1,content_block:{type:'text',text:'你好'}})+anthropic('content_block_delta',{index:1,delta:{type:'text_delta',text:'，世界'}})+anthropic('message_delta',{delta:{stop_reason:'end_turn'}})+anthropic('message_stop'),2);
  assert.equal(stream.finish(),'你好，世界');
});
test('all protocols reject truncation, token limits, empty text and malformed SSE safely',()=>{
  for(const protocol of ['chat','responses','anthropic']) {
    const stream=createModelStream(protocol);assert.throws(()=>stream.finish(),{code:'incomplete'});
    const invalid=createModelStream(protocol);assert.throws(()=>invalid.feed('data: not-json\n\n'),{code:'invalid-event'});
  }
  const chatLimit=createModelStream('chat');assert.throws(()=>chatLimit.feed(chat('partial','length')),{code:'incomplete'});
  const responseLimit=createModelStream('responses');assert.throws(()=>responseLimit.feed(responses('response.incomplete')),{code:'incomplete'});
  const anthropicLimit=createModelStream('anthropic');assert.throws(()=>anthropicLimit.feed(anthropic('message_delta',{delta:{stop_reason:'max_tokens'}})),{code:'incomplete'});
  const empty=createModelStream('chat');empty.feed(event('[DONE]'));assert.throws(()=>empty.finish(),{code:'empty'});
});
test('provider errors and resource caps never expose echoed keys or raw provider bodies',()=>{
  const stream=createModelStream('anthropic');let error;
  try{stream.feed(anthropic('error',{error:{type:'authentication_error',message:'Bearer SENSITIVE-KEY'}}));}catch(e){error=e;}
  assert.equal(error.status,401);assert.doesNotMatch(error.message+friendlyHTTPError(error),/SENSITIVE|Bearer/);
  const large=createModelStream('chat');assert.throws(()=>large.feed('data: '+'x'.repeat(MAX_MODEL_TEXT+1)),{code:'too-large'});
});
function httpFixture(chunks,{mime='text/event-stream',status=200,after,inspect}={}) {
  let calls=0,cancelled=false;
  return {get calls(){return calls;},get cancelled(){return cancelled;},async request(method,url,options) {
    calls++;inspect?.(options);assert.equal(method,'POST');
    const listeners={},xhr={status,responseText:'',getResponseHeader:()=>mime,overrideMimeType(){},addEventListener(name,fn){listeners[name]=fn;},abort(){cancelled=true;}};
    options.requestObserver(xhr);options.cancellerReceiver(()=>xhr.abort());
    for(const chunk of chunks){xhr.responseText+=chunk;listeners.progress?.();after?.(xhr);if(cancelled)throw new Error('native abort');}
    return xhr;
  }};
}
const request=protocol=>buildRequest({protocol,baseURL:'http://127.0.0.1:1/v1',model:'fixture'},'NOT-A-REAL-KEY',[{role:'user',content:'test'}]);
test('native XHR progress emits incremental text before the POST resolves; no retries or redirects',async()=>{
  let resolved=false,handle=null;const updates=[];
  const http=httpFixture([chat('先'),chat('后'),chat('','stop'),event('[DONE]')],{inspect:o=>{
    assert.equal(o.responseType,'text');assert.equal(o.noRetryOnThrottle,true);assert.equal(o.followRedirects,false);assert.equal(o.anon,true);assert.equal(o.debug,false);assert.equal(o.logBodyLength,0);assert.equal(o.successCodes,false);assert.equal(JSON.parse(o.body).stream,true);
  }});
  const text=await requestModel(http,request('chat'),'chat',{onText:t=>{assert.equal(resolved,false);updates.push(t);},setCancel:c=>handle=c});resolved=true;
  assert.equal(text,'先后');assert.deepEqual(updates,['先','先后']);assert.equal(handle,null);assert.equal(http.calls,1);
});
test('relay ignoring stream returns JSON in the same POST, never falls back to a charged second request',async()=>{
  for(const protocol of ['chat','responses','anthropic']) {
    const value=protocol==='chat' ? {choices:[{message:{content:'说明'},finish_reason:'stop'}]} : protocol==='responses' ? {status:'completed',output_text:'说明'} : {content:[{type:'text',text:'说明'}],stop_reason:'end_turn'};
    const http=httpFixture([JSON.stringify(value)],{mime:'application/json'});
    assert.equal(await requestModel(http,request(protocol),protocol),'说明');assert.equal(http.calls,1);
  }
});
test('mislabelled SSE and fragmented prefixes are recognized and decode text once',async()=>{
  const http=httpFixture(['ev','ent: message\n'+chat('文本')+chat('','stop')],{mime:'text/plain'});
  assert.equal(await requestModel(http,request('chat'),'chat'),'文本');
});
test('HTTP errors, redirects and incomplete JSON stop without re-sending or showing error bodies',async()=>{
  for(const status of [302,401,429,500]) {
    let calls=0;const http=httpFixture(['sensitive body'],{status,after:()=>calls++});
    await assert.rejects(requestModel(http,request('chat'),'chat'),e=>e.status===status);assert.equal(http.calls,1);
  }
  const truncated=httpFixture([JSON.stringify({choices:[{message:{content:'partial'},finish_reason:'length'}]})],{mime:'application/json'});
  await assert.rejects(requestModel(truncated,request('chat'),'chat'),{code:'incomplete'});
});
test('explicit cancel stops the native request, clears the handle and rejects partial content',async()=>{
  let cancelled=false,handle=null;
  const http=httpFixture([chat('partial'),chat('more')],{after:()=>{cancelled=true;handle?.();}});
  await assert.rejects(requestModel(http,request('chat'),'chat',{setCancel:c=>handle=c,isCancelled:()=>cancelled}),{code:'cancelled'});
  assert.equal(handle,null);assert.equal(http.cancelled,true);assert.equal(http.calls,1);
});
test('malformed progress aborts the transport and surfaces a safe parser error',async()=>{
  const http=httpFixture(['data: {broken}\n\n',chat('later','stop')]);
  await assert.rejects(requestModel(http,request('chat'),'chat'),{code:'invalid-event'});assert.equal(http.cancelled,true);assert.equal(http.calls,1);
});
