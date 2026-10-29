import test from 'node:test';
import assert from 'node:assert/strict';
import {captureExplanationSelection,MAX_SELECTION_LENGTH} from '../src/explanation-selection.mjs';
import {explanationMessages} from '../src/model-adapter.mjs';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';

function fixture(text,{hidden=false,connected=true,otherSession=false,otherAnswer=false,user=false,generated=true,context=text}={}) {
 const article={dataset:{nodeId:'parent'},isConnected:connected,hidden};
 const answer={},endAnswer=otherAnswer ? {} : answer;
 const make=(root,last=false)=>({nodeType:1,closest(selector){
  if(selector==='[data-node-id]')return last && otherSession ? {} : article;
  if(selector==='.message.user')return user ? {} : null;
  if(selector.startsWith('p,'))return {textContent:context};
  return generated ? root : null;
 }});
 const start=make(answer),end=make(endAnswer,true),range={startContainer:start,endContainer:end,commonAncestorContainer:start,cloneRange(){return this;}};
 return {isCollapsed:false,rangeCount:1,toString:()=>text,getRangeAt:()=>range};
}

test('whole paragraphs larger than both former limits are retained with TeX and line breaks',()=>{
 const text=('中文和 English paragraph with $z_i$ and $z_j$. '.repeat(125)+'\n\nEnding evidence.').replace('\\n\\n','\n\n');
 assert.ok(text.length>1200 && text.length<MAX_SELECTION_LENGTH);
 const selected=captureExplanationSelection(fixture(text));assert.equal(selected.text,text);assert.equal(selected.nodeId,'parent');
 const payload=JSON.parse(explanationMessages({concept:text,source:{selectedText:selected.text,context:selected.context}},{title:'Paper'})[1].content);
 assert.equal(payload.selectedConcept,text);assert.equal(payload.selectedText,text);assert.ok(payload.selectedText.endsWith('Ending evidence.'));
});
test('the common paragraph limit accepts the boundary and refuses an oversized selection without clipping',()=>{
 const text='a'.repeat(MAX_SELECTION_LENGTH);assert.equal(captureExplanationSelection(fixture(text)).text,text);
 assert.equal(captureExplanationSelection(fixture(text+'b')),null);
 assert.equal(captureExplanationSelection(fixture('text'),{maxLength:3}),null);
 assert.equal(captureExplanationSelection(fixture('   \n  ')),null);
});
test('large selections still exclude drafts, user messages, other sessions and cross-reply ranges',()=>{
 for(const options of [{hidden:true},{connected:false},{otherSession:true},{otherAnswer:true},{user:true},{generated:false}])assert.equal(captureExplanationSelection(fixture('Long selected passage '.repeat(200),options)),null,JSON.stringify(options));
 const collapsed=fixture('Passage');collapsed.isCollapsed=true;assert.equal(captureExplanationSelection(collapsed),null);
 const multi=fixture('Passage');multi.rangeCount=2;assert.equal(captureExplanationSelection(multi),null);
});
test('a capped nearby context does not truncate the selected passage',()=>{
 const text='Selected paragraph. '.repeat(450).trim(),selection=captureExplanationSelection(fixture(text,{context:'Earlier material. '.repeat(400)+text}));
 assert.equal(selection.text,text);assert.equal(selection.context.length,4000);assert.ok(selection.text.length>selection.context.length);
});
test('long passage sessions round-trip through the unchanged archive schema and request payload',async()=>{
 let disk=null;const storage={read:async()=>structuredClone(disk),write:async value=>{disk=structuredClone(value);}};
 const store=await KnowledgeTreeStore.open(storage),document=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001'});
 const text='完整段落 with equations $L=-\\log p$. '.repeat(180);
 const node=await store.createSession({documentId:document.id,concept:text,source:{selectedText:text,context:'Nearby paragraph'}});
 const restored=await KnowledgeTreeStore.open(storage);assert.equal(restored.snapshot().version,1);assert.deepEqual(restored.getSession(node.id),node);
 assert.equal(JSON.parse(explanationMessages(restored.getSession(node.id),document)[1].content).selectedText,text);
});
