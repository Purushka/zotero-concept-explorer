import {explanationMessages,conversationMessages,parseExplanation} from './model-adapter.mjs';
import {normalizeAnswer} from './explanation-format.mjs';

export async function readSessionFullText(Zotero,document,t) {
  const identity=document?.identity;
  let attachment;
  try{attachment=identity && Zotero.Items.getByLibraryAndKey(identity.libraryId,identity.attachmentKey);}
  catch{throw new Error(t('fullTextReadFailed'));}
  if(!attachment || attachment.deleted || !attachment.isPDFAttachment?.())throw new Error(t('fullTextAttachmentMissing'));
  let result;
  try {result=await Zotero.PDFWorker.getFullText(attachment.id,null);}
  catch {throw new Error(t('fullTextReadFailed'));}
  if(typeof result?.text!=='string' || !result.text.trim())throw new Error(t('fullTextEmpty'));
  if(Number.isFinite(result.totalPages) && Number.isFinite(result.extractedPages) && result.extractedPages<result.totalPages)throw new Error(t('fullTextIncomplete'));
  return {text:result.text,totalPages:result.totalPages};
}

export function createFullTextAnswers({Zotero,store,jobs,request,ancestors,notify,endJob,isAlive,t,localize=messages=>messages}) {
  const current=(nodeId,job)=>isAlive() && jobs.get(nodeId)===job && !job.cancelled && store.snapshot().nodes.some(node=>node.id===nodeId);
  async function answer(nodeId,previous,document,target,job) {
    try {
      const fullText=await readSessionFullText(Zotero,document,t);
      if(!current(nodeId,job))return;
      const messages=target
        ? conversationMessages({...previous,messages:previous.messages.slice(0,target.historyEnd)},target.question,{fullText})
        : explanationMessages(previous,document,ancestors(previous),{fullText});
      job.phase='answering';notify();
      const answer=await request(localize(messages),job);
      if(!current(nodeId,job))return;
      const shouldCommit=()=>current(nodeId,job);
      if(!target)await store.setExplanation(nodeId,parseExplanation(answer),{shouldCommit});
      else if(target.role==='assistant')await store.replaceAssistantMessage(nodeId,target.id,normalizeAnswer(answer),{expectedContent:target.content,shouldCommit});
      else await store.appendMessage(nodeId,{role:'assistant',content:normalizeAnswer(answer)},{shouldCommit});
      if(current(nodeId,job))job.status='saved';
    } catch(error) {if(current(nodeId,job))endJob(job,error);}
    if(jobs.get(nodeId)===job)notify();
  }
  function regenerate(nodeId,messageId=null) {
    if(!isAlive() || jobs.get(nodeId)?.status==='loading')return;
    const previous=store.getSession(nodeId);
    const document=store.snapshot().documents.find(doc=>doc.id===previous.documentId);
    let target=null;
    if(messageId) {
      const index=previous.messages.findIndex(message=>message.id===messageId),message=previous.messages[index];
      const question=message?.role==='assistant' ? previous.messages[index-1] : message;
      if(!message || question?.role!=='user' || (message.role==='user' && index!==previous.messages.length-1))throw new Error(t('fullTextQuestionMissing'));
      target={...message,question:question.content,historyEnd:message.role==='assistant' ? index-1 : index};
    }
    const job={status:'loading',kind:target ? 'ask' : 'explanation',cancelled:false,fullText:true,messageId,phase:'reading'};
    jobs.set(nodeId,job);notify();
    // Return immediately: the panel's serialized actions must still admit Stop.
    void answer(nodeId,previous,document,target,job);
  }
  return {regenerate};
}
