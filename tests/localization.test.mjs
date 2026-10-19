import test from 'node:test';
import assert from 'node:assert/strict';
import {messages} from '../src/locales.mjs';
import {createLocalizer,resolveLocale,localizeModelMessages} from '../src/localization.mjs';
import {explanationMessages,conversationMessages} from '../src/model-adapter.mjs';
import {confirmSessionDeletion} from '../src/session-deletion.mjs';

test('automatic language follows Zotero scripts/regions and falls back to English',()=>{
  for(const locale of ['zh-CN','zh-Hans','zh_SG','zh-Hans-CN'])assert.equal(resolveLocale('auto',locale),'zh-CN');
  for(const locale of ['zh-TW','zh_HK','zh-Hant','zh-Hant-HK','zh-MO'])assert.equal(resolveLocale('auto',locale),'zh-TW');
  for(const locale of ['en-GB','fr-FR','de','',undefined])assert.equal(resolveLocale('auto',locale),'en-US');
  assert.equal(resolveLocale('en-US','zh-CN'),'en-US');
  assert.equal(resolveLocale('zh-TW','en-US'),'zh-TW');
});

test('bundled catalogs initialize synchronously and preserve variable values',()=>{
  const l10n=createLocalizer('en-US');
  assert.equal(l10n.t('settings'),'Settings');
  assert.equal(l10n.t('nodeCount',{count:1}),'1 concept');
  assert.equal(l10n.t('nodeCount',{count:2}),'2 concepts');
  assert.equal(l10n.t('deleteTitle',{concept:'<script> & 中文'}),'Delete node: <script> & 中文');
  l10n.setLocale('zh-TW');assert.equal(l10n.t('settings'),'設定');
  l10n.setLocale('zh-CN');assert.equal(l10n.t('settings'),'设置');
  for(const [key,values] of Object.entries(messages)){
    assert.equal(values.length,3,key);
    const variables=value=>[...value.matchAll(/{{(\w+)}}/g)].map(m=>m[1]).sort();
    for(const value of values){assert(value.trim(),key);assert.deepEqual(variables(value),variables(values[0]),key);}
  }
});

test('safe existing API errors are localized without exposing provider response text',()=>{
  const l10n=createLocalizer('en-US');
  assert.equal(l10n.message('请先保存有效的 API Key。'),'Save a valid API key first.');
  assert.match(l10n.message('中转站暂时出错（HTTP 503），现有页面与知识树已保留。'),/HTTP 503/);
  assert(!/\p{Script=Han}/u.test(l10n.message('接口请求被拒绝（HTTP 400）。请核对协议与模型名称。')));
  assert.equal(l10n.message('User text stays unchanged'),'User text stays unchanged');
});

test('output language changes only the system directive, never context or prior answers',()=>{
  const session={concept:'后验分布',source:{selectedText:'selected 原文',context:'paper context',location:{pageIndex:0}},explanation:{summary:'旧解释',detail:'saved detail'},messages:[{role:'assistant',content:'already saved 中文'}]};
  const original=structuredClone(session),explanation=explanationMessages(session,{title:'Paper'},[]),conversation=conversationMessages(session,'用户问题');
  assert.strictEqual(localizeModelMessages(explanation,'zh-CN'),explanation);
  for(const [locale,directive] of [['en-US','使用英文'],['zh-TW','使用繁體中文']]){
    for(const input of [explanation,conversation]){
      const result=localizeModelMessages(input,locale);
      assert.match(result[0].content,new RegExp(directive));
      assert(!result[0].content.includes('用中文，从'));
      assert.deepEqual(result.slice(1),input.slice(1));
      assert.equal(result.length,input.length);
    }
  }
  assert.deepEqual(session,original);
});

test('native deletion confirmations use the selected language with safe cancel defaults',()=>{
  const options=[],Zotero={Prompt:{BUTTON_TITLE_CANCEL:2,confirm:value=>{options.push(value);return 2;}}};
  assert.equal(confirmSessionDeletion(Zotero,null,{concept:'Parent <concept>',descendantCount:2},createLocalizer('en-US')),null);
  assert.equal(options[0].title,'Delete concept node');
  assert.equal(options[0].defaultButton,2);
  assert.match(options[0].text,/Parent <concept>/);assert.match(options[0].text,/remove 3 nodes/);
  assert.equal(options[0].button1,'Delete entire branch (3 nodes)');
  confirmSessionDeletion(Zotero,null,{concept:'概念',descendantCount:0},createLocalizer('zh-TW'));
  assert.equal(options[1].title,'刪除概念節點');assert.equal(options[1].defaultButton,1);
});
