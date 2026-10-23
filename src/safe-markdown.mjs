import texmath from '../vendor/texmath.cjs';
// Keep the same security and expansion limits in string and DOM rendering.
export function mathOptions(displayMode=false) {
  return {displayMode,output:'htmlAndMathml',trust:false,strict:'ignore',throwOnError:false,
    maxExpand:200,maxSize:8,macros:{}};
}
// Privileged Gecko sanitizes innerHTML. Insert only ordinary placeholders there,
// then let KaTeX construct the formula using DOM APIs (including MathML and SVG).
export function hydrateMath(container,katex) {
  for (const token of container.querySelectorAll('.math-token')) {
    const formula=token.textContent;
    try {
      if (!katex?.render) throw new Error('Math renderer unavailable');
      katex.render(formula,token,mathOptions(token.classList.contains('math-display')));
      token.classList.remove('math-token');
    } catch {
      token.textContent=formula;token.classList.remove('math-token');token.classList.add('math-error');
    }
  }
}
// markdown-it is bundled locally; raw HTML, external links and images stay inert.
export function createSafeMarkdown(markdownit,{conceptPlaceholders=false,mathPlaceholders=false,katex=null}={}) {
  const md = markdownit({html:false,linkify:false,typographer:false,breaks:true});
  const escape = md.utils.escapeHtml;
  if(katex || mathPlaceholders) {
    md.use(texmath,{
      delimiters:['brackets','dollars'],
      engine:{renderToString:(formula,options) => katex.renderToString(formula,mathOptions(!!options.displayMode))}
    });
    if(mathPlaceholders) {
      for(const name of [...texmath.inlineRuleNames,...texmath.blockRuleNames]) {
        md.renderer.rules[name]=(tokens,index)=>{
          const token=tokens[index],display=name!=='math_inline';
          const tag=name.startsWith('math_block') ? 'div' : 'span';
          const number=name==='math_block_eqno' && token.info ? '<span class="math-number">('+escape(token.info)+')</span>' : '';
          return '<'+tag+' class="math-token '+(display ? 'math-display' : 'math-inline')+'">'+escape(token.content)+'</'+tag+'>'+number;
        };
      }
    }
  }
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
  md.renderer.rules.concept = (tokens,index) => conceptPlaceholders ? '<span class="concept-token">'+escape(tokens[index].content)+'</span>' : '<button type="button" class="concept-link" data-concept="'+escape(tokens[index].content)+'">'+escape(tokens[index].content)+'</button>';
  md.renderer.rules.link_open = () => '<span class="inert-link">';
  md.renderer.rules.link_close = () => '</span>';
  md.renderer.rules.image = (tokens,index) => '<span class="inert-link">[图片已省略：'+escape(tokens[index].content)+']</span>';
  const render=text => md.render(String(text ?? ''));
  render.inline=text => md.renderInline(String(text ?? ''));
  return render;
}
