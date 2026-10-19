import texmath from '../vendor/texmath.cjs';
// markdown-it is bundled locally; raw HTML, external links and images stay inert.
export function createSafeMarkdown(markdownit,{conceptPlaceholders=false,katex=null}={}) {
  const md = markdownit({html:false,linkify:false,typographer:false,breaks:true});
  if(katex) md.use(texmath,{
    delimiters:['brackets','dollars'],
    engine:{renderToString:(formula,options) => katex.renderToString(formula,{
      ...options,output:'html',trust:false,strict:'ignore',throwOnError:false,
      maxExpand:200,maxSize:8,macros:{} // isolated per formula; never share model-defined macros
    })}
  });
  md.inline.ruler.before('link','concept',function(state,silent) {
    if (state.src.slice(state.pos,state.pos+2) !== '[[') return false;
    const end = state.src.indexOf(']]',state.pos+2);
    if (end < 0) return false;
    const concept = state.src.slice(state.pos+2,end).trim();
    if (!concept || concept.length > 180 || /[\r\n]/.test(concept)) return false;
    if (!silent) { const token=state.push('concept','',0); token.content=concept; }
    state.pos=end+2;
    return true;
  });
  const escape = md.utils.escapeHtml;
  md.renderer.rules.concept = (tokens,index) => conceptPlaceholders ? `<span class="concept-token">${escape(tokens[index].content)}</span>` : `<button type="button" class="concept-link" data-concept="${escape(tokens[index].content)}">${escape(tokens[index].content)}</button>`;
  md.renderer.rules.link_open = () => '<span class="inert-link">';
  md.renderer.rules.link_close = () => '</span>';
  md.renderer.rules.image = (tokens,index) => `<span class="inert-link">[图片已省略：${escape(tokens[index].content)}]</span>`;
  return text => md.render(String(text ?? ''));
}
