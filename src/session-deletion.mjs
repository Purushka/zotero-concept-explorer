import {createLocalizer} from './localization.mjs';
// Confirmation and storage use the existing Zotero prompt/transaction APIs.
// Abort requests only after a successful atomic deletion: a failed save keeps
// both the archive and its in-flight work intact.
export async function deleteSessionWithConfirmation({store,nodeId,jobs,confirm}) {
  const plan = store.getDeletionPlan(nodeId);
  const mode = await confirm(plan);
  if (mode === null) return null;
  if (!['node','subtree'].includes(mode)) throw new Error('Unknown deletion mode');
  const result = await store.deleteSession(nodeId,{mode,expectedNodeIds:mode === 'subtree' ? plan.nodeIds : [nodeId]});
  for (const id of result.deletedNodeIds) {
    const job = jobs.get(id);
    if (job) { job.cancelled = true; try { job.cancel?.(); } catch {} }
    jobs.delete(id);
  }
  return result;
}

export function confirmSessionDeletion(Zotero,window,plan,localizer=createLocalizer()) {
  const t=(key,values)=>localizer.t(key,values);
  const count = plan.descendantCount, name = plan.concept.slice(0,180);
  if (!count) {
    const choice = Zotero.Prompt.confirm({window,title:t("deletionHeading"),
      text:t('deletionSingle',{name}),
      button0:t("deleteNode"),button1:Zotero.Prompt.BUTTON_TITLE_CANCEL,defaultButton:1});
    return choice === 0 ? 'subtree' : null;
  }
  const choice = Zotero.Prompt.confirm({window,title:t("deletionHeading"),
    text:t('deletionBranch',{name,count,total:count+1}),
    button0:t("deleteOnly"),button1:t('deleteBranch',{count:count+1}),button2:Zotero.Prompt.BUTTON_TITLE_CANCEL,defaultButton:2});
  return choice === 0 ? 'node' : choice === 1 ? 'subtree' : null;
}
