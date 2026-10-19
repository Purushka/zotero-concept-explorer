import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createSafeMarkdown} from '../src/safe-markdown.mjs';
const scope={}; vm.runInNewContext(await readFile(new URL('../vendor/markdown-it.js',import.meta.url),'utf8'),scope);
const render=createSafeMarkdown(scope.markdownit);
test('necessary concepts become local interactive buttons',() => {
  const html=render('先理解 [[条件概率]]，再看 **公式**。');
  assert.match(html,/data-concept="条件概率"/); assert.match(html,/<strong>公式<\/strong>/);
});
test('model HTML, links and images cannot execute or load remote resources',() => {
  const html=render('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n[点我](https://example.com)\n\n![图](https://example.com/pixel)');
  assert.doesNotMatch(html,/<script\b|<img\b|<a\b/); assert.match(html,/&lt;script&gt;/); assert.match(html,/图片已省略/);
});
test('concept attributes are escaped and code spans remain noninteractive',() => {
  const html=render('[[x" onclick="alert(1)]] `[[不是概念按钮]]`');
  assert.match(html,/data-concept="x&quot; onclick=&quot;alert\(1\)"/);
  assert.doesNotMatch(html,/" onclick="/); assert.match(html,/<code>\[\[不是概念按钮\]\]<\/code>/);
});

test('Gecko-safe concept placeholders contain only escaped labels, never model attributes',() => {
  const html=createSafeMarkdown(scope.markdownit,{conceptPlaceholders:true})('[[x" onclick="alert(1)]] `[[code]]` <span class="concept-token">spoof</span>');
  assert.match(html,/<span class="concept-token">x&quot; onclick=&quot;alert\(1\)<\/span>/);
  assert.doesNotMatch(html,/<button|data-concept=|" onclick="/);assert.match(html,/<code>\[\[code\]\]<\/code>/);assert.match(html,/&lt;span/);
});const katexScope={};vm.runInNewContext(await readFile(new URL('../vendor/katex/katex.min.js',import.meta.url),'utf8'),katexScope);
const mathRender=createSafeMarkdown(scope.markdownit,{katex:katexScope.katex});
test('both dollar and bracket LaTeX render locally without consuming code or concept syntax',()=>{
  const html=mathRender(String.raw`$\theta + \frac{1}{2}$，\(n\)。

\[a_t=[a_1,\ldots,a_n]\]

$$x=\sum_i a_i$$

`+'先理解 [[概率]]，代码 `$not_math$`。');
  assert.ok((html.match(/class="katex"/g) ?? []).length>=4);assert.match(html,/data-concept="概率"/);assert.match(html,/<code>\$not_math\$<\/code>/);
});
test('untrusted math cannot inject links/images/HTML or expand macros without bounds',()=>{
  const html=mathRender(String.raw`$\href{https://example.com}{bad}$ $\includegraphics{https://example.com/x}$ $\htmlStyle{background:url(https://example.com)}{x}$ $\def\a{\a}\a$`);
  assert.doesNotMatch(html,/<a\b|<img\b|<script\b|style="[^"]*background:url/);assert.match(html,/katex/);
});
test('formula macros never leak into another formula or another rendering',()=>{
  mathRender(String.raw`$\gdef\personal{INJECTED}\personal$`);
  const html=mathRender(String.raw`$\personal$`);assert.doesNotMatch(html,/INJECTED/);
});
