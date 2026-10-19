import i18next from '../vendor/i18next.cjs';
import {messages} from './locales.mjs';

export const LANGUAGES = ['auto', 'zh-CN', 'zh-TW', 'en-US'];
const locales = LANGUAGES.slice(1);
const resources = Object.fromEntries(locales.map((locale,index) => [locale,
  {translation:Object.fromEntries(Object.entries(messages).map(([key,values]) => [key,values[index]]))}]));
const legacyKeys = new Map(Object.entries(messages).flatMap(([key,values]) =>
  values.filter(value => !value.includes('{{')).map(value => [value,key])));

export function resolveLocale(preference = 'auto', hostLocale = 'en-US') {
  if (preference !== 'auto' && locales.includes(preference)) return preference;
  const host = String(hostLocale || 'en-US').replaceAll('_','-').toLowerCase();
  if (/^zh(?:-|$)/.test(host)) return /(?:^|-)(?:tw|hk|mo|hant)(?:-|$)/.test(host) ? 'zh-TW' : 'zh-CN';
  return 'en-US';
}

export function createLocalizer(locale = 'zh-CN') {
  const engine = i18next.createInstance();
  // Bundled resources and synchronous init work in both bootstrap and iframe
  // scopes. No detector, storage backend, timer, or network request is needed.
  engine.init({lng:resolveLocale(locale),resources,fallbackLng:'en-US',supportedLngs:locales,
    load:'currentOnly',initImmediate:false,keySeparator:false,nsSeparator:false,
    interpolation:{escapeValue:false},returnNull:false});
  return {
    get locale() { return engine.language; },
    setLocale(value) { const next=resolveLocale(value);if (next === engine.language) return false;void engine.changeLanguage(next);return true; },
    t(key,values) { return engine.t(key,values); },
    // Existing model/storage validation still emits its original safe messages.
    // Translate at the presentation boundary; never translate user/model content.
    message(value) {
      const text=String(value ?? ''),key=legacyKeys.get(text);
      if (key) return engine.t(key);
      const server=/^中转站暂时出错（HTTP (\d+)），现有页面与知识树已保留。$/.exec(text);
      if(server)return engine.t('serverError',{status:server[1]});
      const rejected=/^接口请求被拒绝（HTTP (\d+)）。请核对协议与模型名称。$/.exec(text);
      if(rejected)return engine.t('requestRejected',{status:rejected[1]});
      return text;
    },
  };
}

export function translateDOM(root,localizer) {
  for (const attribute of ['data-i18n','data-i18n-title','data-i18n-aria-label','data-i18n-placeholder']) {
    const nodes=[...(root.matches?.('['+attribute+']') ? [root] : []),...root.querySelectorAll('['+attribute+']')];
    for (const node of nodes) {
      const text=localizer.t(node.getAttribute(attribute));
      if(attribute==='data-i18n')node.textContent=text;
      else node.setAttribute(attribute.slice('data-i18n-'.length),text);
    }
  }
}

// Only the requested output-language directive changes. The original paper,
// context, JSON schema, generation flow, and historical answers stay untouched.
export function localizeModelMessages(input,locale) {
  const language=resolveLocale(locale);
  if(language==='zh-CN')return input;
  const directive=language==='zh-TW' ? '繁體中文' : '英文';
  return input.map(message => message.role!=='system' ? message : {...message,
    content:message.content.replace('用中文，从读者正在看的句子出发：','使用'+directive+'，从读者正在看的句子出发：')
      .replace('你是中文论文阅读助手。','你是论文阅读助手，请使用'+directive+'回答。')});
}
