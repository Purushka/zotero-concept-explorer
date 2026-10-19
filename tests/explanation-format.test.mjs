import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExplanation,recoverExplanation,normalizeAnswer} from '../src/explanation-format.mjs';
const malformed=String.raw`{"summary":""50 步的关节空间动作序列"是一次提出的计划。","detail":"### 它是什么意思\n\n原文：\n> a joint-space sequence\n\n例如 "关节空间" 的动作。\n\n\[a_t = [a_1, \ldots, a_n]\]\n\n公式 \(n\) 和 $\theta + \frac{1}{2}$。\n\n- 不是完整执行 50 步。"}`;
test('screenshot-style invalid quotes/newline/LaTeX become Markdown, never a JSON blob',()=>{
  const v=parseExplanation(malformed);
  assert.equal(v.summary,'"50 步的关节空间动作序列"是一次提出的计划。');
  assert.match(v.detail,/^### 它是什么意思\n\n/);
  assert.ok(v.detail.includes(String.raw`\[a_t = [a_1, \ldots, a_n]\]`));
  assert.ok(v.detail.includes(String.raw`$\theta + \frac{1}{2}$`));
  assert.ok(v.detail.includes(String.raw`\(n\)`));
  assert.doesNotMatch(v.detail,/"summary"|"detail"/);
});
test('valid JSON, fences and double-encoded envelopes preserve code/paths/math exactly',()=>{
  const expected={summary:'说明',detail:String.raw`## 标题

公式 $\theta$、\(x\) 和 \[x=\frac12\]。

路径 C:\new\text 和代码 \n。`};
  for(const raw of [JSON.stringify(expected),'\x60\x60\x60json\n'+JSON.stringify(expected)+'\n\x60\x60\x60',JSON.stringify(JSON.stringify(expected))]) {
    const parsed=parseExplanation(raw);assert.equal(parsed.summary,expected.summary);assert.equal(parsed.detail,expected.detail);
  }
});
test('plain Markdown, code snippets and literal slash-n are not rewritten',()=>{
  const raw=String.raw`## Markdown

路径 C:\new\text，代码 \n。`;
  assert.equal(parseExplanation(raw).detail,raw);assert.equal(normalizeAnswer(raw),raw);
});
test('partial envelopes produce progressive fields and never display keys or wrappers',()=>{
  const text=JSON.stringify({summary:'流式简述。',detail:'## 原理\n\n详细文字 [[概念]]。'});
  let sawSummary=false,sawDetail=false;
  for(let i=1;i<=text.length;i++){
    const preview=parseExplanation(text.slice(0,i),{partial:true});
    assert.doesNotMatch(preview.summary+'\n'+preview.detail,/"summary"|"detail"|^\{/);
    if(preview.summary.includes('流式'))sawSummary=true;
    if(i<text.length && preview.detail.includes('详细'))sawDetail=true;
  }
  assert.ok(sawSummary && sawDetail);
});
test('legacy recovery does not mutate the persisted explanation or truncate detail',()=>{
  const previous={summary:malformed,detail:malformed,format:'markdown'},snapshot=JSON.stringify(previous);
  const recovered=recoverExplanation(previous);assert.equal(JSON.stringify(previous),snapshot);
  assert.match(recovered.detail,/^###/);assert.equal(normalizeAnswer(malformed),recovered.detail);
});
test('incomplete structured follow-up does not flash raw keys',()=>{
  assert.equal(normalizeAnswer('{"sum',{partial:true}),'');
  assert.equal(normalizeAnswer('{"summary":"简述","detail":"正在生成',{partial:true}),'正在生成');
});

test('partial double-encoded and fenced JSON never flash envelope syntax',()=>{
  const payload=JSON.stringify({summary:'逐字简述',detail:'## 正文\n\n公式 $x$。'});
  for(const raw of [JSON.stringify(payload),'\x60\x60\x60json\n'+payload+'\n\x60\x60\x60']) {
    let sawDetail=false;
    for(let i=1;i<=raw.length;i++) {
      const preview=parseExplanation(raw.slice(0,i),{partial:true});
      assert.doesNotMatch(preview.summary+'\n'+preview.detail,/"summary"|"detail"|^\{|^"\{|^\x60/);
      if(i<raw.length && preview.detail.includes('公式'))sawDetail=true;
    }
    assert.ok(sawDetail);
  }
});
