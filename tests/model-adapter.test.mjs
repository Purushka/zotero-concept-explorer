import test from 'node:test';
import assert from 'node:assert/strict';
import {endpointFor,validateModelConfig,buildRequest,readModelText,parseExplanation,explanationMessages,friendlyHTTPError} from '../src/model-adapter.mjs';
test('relay roots, version prefixes and complete endpoints are normalized once',() => {
  assert.equal(endpointFor('chat','https://relay.example/'),'https://relay.example/v1/chat/completions');
  assert.equal(endpointFor('responses','https://relay.example/'),'https://relay.example/responses');
  assert.equal(endpointFor('responses','https://relay.example/v1/'),'https://relay.example/v1/responses');
  assert.equal(endpointFor('anthropic','https://relay.example/api/anthropic/v1'),'https://relay.example/api/anthropic/v1/messages');
  assert.equal(endpointFor('chat','https://relay.example/v1/chat/completions/'),'https://relay.example/v1/chat/completions');
  assert.equal(endpointFor('chat','http://127.0.0.1:9000/v1'),'http://127.0.0.1:9000/v1/chat/completions');
});
test('unsafe addresses and incompatible protocols are rejected before sending credentials',() => {
  for (const url of ['http://relay.example/v1','https://user:password@relay.example/v1','https://relay.example/v1?key=x','https://relay.example/v1#x','file:///etc/passwd','not a url']) assert.throws(() => endpointFor('chat',url));
  assert.throws(() => endpointFor('responses','https://relay.example/v1/messages'));
  assert.throws(() => validateModelConfig({baseURL:'https://relay.example',model:''}));
});
test('three request formats use the appropriate headers without forcing JSON support',() => {
  const messages=[{role:'system',content:'中文说明'},{role:'user',content:'概念'}];
  for (const protocol of ['chat','responses','anthropic']) {
    const r=buildRequest({protocol,baseURL:'https://relay.example/v1',model:'provider-model'},'test-key-only',messages);
    assert.equal(r.body.model,'provider-model'); assert.equal(r.body.stream,true);
    assert.equal(r.body.response_format,undefined);
    if (protocol === 'anthropic') { assert.equal(r.headers['x-api-key'],'test-key-only'); assert.equal(r.body.system,'中文说明'); }
    else assert.equal(r.headers.Authorization,'Bearer test-key-only');
    if (protocol === 'responses') { assert.equal(r.body.store,false); assert.deepEqual(r.body.input,messages.slice(1)); }
  }
  for(const protocol of ['chat','responses','anthropic']) assert.equal(buildRequest({protocol,baseURL:'https://relay.example/v1',model:'m'},'test',messages,{probe:true}).body.stream,false);
  assert.equal(buildRequest({protocol:'chat',baseURL:'https://relay.example',model:'model'},'test',messages,{probe:true}).body.max_tokens,undefined);
  assert.throws(() => buildRequest({model:'model',baseURL:'https://relay.example'},'',messages));
});
test('all response formats extract actual text and reject empty or reasoning-only output',() => {
  assert.equal(readModelText('chat',{choices:[{message:{content:'说明'}}]}),'说明');
  assert.equal(readModelText('responses',{output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'说明'}]}]}),'说明');
  assert.equal(readModelText('anthropic',{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'说明'}]}),'说明');
  assert.throws(() => readModelText('chat',{choices:[{message:{reasoning_content:'thought'}}]}));
});
test('explanation JSON and plain provider replies are preserved without truncation',() => {
  const detail='## 原理\n'+('具体说明。'.repeat(12000));
  assert.equal(parseExplanation('```json\n'+JSON.stringify({summary:'简述',detail})+'\n```').detail,detail);
  assert.deepEqual(parseExplanation('简述\n\n详细说明'),{summary:'简述',detail:'简述\n\n详细说明',format:'markdown'});
  assert.equal(parseExplanation('{"summary":null}').detail,'{"summary":null}');
});
test('prompt describes only the selected concept and raw errors never disclose a key',() => {
  const messages=explanationMessages({concept:'选中概念',source:{selectedText:'选中概念',context:'附近句子'}},{title:'论文'});
  assert.match(messages[0].content,/只解释/); assert.match(messages[1].content,/附近句子/);
  const error=friendlyHTTPError({status:401,message:'Authorization Bearer secret',body:'secret'});
  assert.doesNotMatch(error,/secret|Bearer/); assert.match(error,/认证/);
  assert.match(friendlyHTTPError({status:302}),/重定向/);
});

test('explanation and conversation prompts request distinct display-math delimiters',async()=>{
  const {conversationMessages}=await import('../src/model-adapter.mjs');
  const node={concept:'R3M',source:{selectedText:'InfoNCE',context:'Paper'},explanation:{summary:'',detail:''},messages:[]};
  for(const messages of [explanationMessages(node,{title:'R3M'},[]),conversationMessages(node,'Explain $z_i^b$')]) {
    assert.ok(messages[0].content.includes('独立公式用 $$...$$'));assert.ok(messages[0].content.includes('行内公式用 $...$'));
  }
});
