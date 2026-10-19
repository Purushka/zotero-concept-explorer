// Capture only generated explanation/assistant text, never a draft, toolbar,
// source quotation or text from two different sessions. Both panel surfaces
// share this policy and create children through the existing knowledge store.
const generated='.answer,.message.assistant,.stream-preview';
const parent=node=>node?.nodeType===1?node:node?.parentElement;
export function captureExplanationSelection(selection,{maxLength=600}={}) {
  if(!selection || selection.isCollapsed || selection.rangeCount!==1)return null;
  const text=selection.toString().trim();if(!text || text.length>maxLength)return null;
  const range=selection.getRangeAt(0);
  const start=parent(range.startContainer),end=parent(range.endContainer);
  const article=start?.closest('[data-node-id]');
  if(!article?.isConnected || article.hidden || article!==end?.closest('[data-node-id]'))return null;
  const generatedRoot=start.closest(generated);
  // Never select across separate replies: a user message may lie between two
  // assistant endpoints even though both endpoints individually look valid.
  if(!generatedRoot || generatedRoot!==end.closest(generated))return null;
  if(start.closest('.message.user') || end.closest('.message.user'))return null;
  const contextElement=parent(range.commonAncestorContainer)?.closest('p,li,blockquote,pre,.summary,.detail,.message,.stream-preview') ?? start.closest(generated);
  const context=String(contextElement?.textContent ?? text).slice(0,4000);
  return {nodeId:article.dataset.nodeId,text,context,article,range:range.cloneRange()};
}
