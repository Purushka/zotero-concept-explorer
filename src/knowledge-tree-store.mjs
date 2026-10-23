import pLimit from '../vendor/p-limit.mjs';
import {validGeneration} from './archive-generation.mjs';

export const SCHEMA_VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(`Invalid knowledge archive: ${message}`); };
const check = (condition, message) => { if (!condition) fail(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const id = value => text(value) && value.length > 0 && value.length <= 128;
const time = value => Number.isFinite(value) && value >= 0;
const keys = (value, allowed, label) => {
  check(record(value), `${label} must be an object`);
  check(Object.keys(value).every(key => allowed.includes(key)), `${label} has unsupported fields`);
};
export function emptyArchive() {
  return {version:SCHEMA_VERSION, revision:0, documents:[], nodes:[], workspace:{activeDocumentId:null, pageNodeId:null, floatingNodeId:null, openNodeIds:[], view:'reading', treeSelectionId:null}};
}

// Validate before reading or replacing any archive; never silently prune or reset it.
export function validateArchive(state) {
  keys(state, ['version','revision','documents','nodes','workspace'], 'archive');
  check(state.version === SCHEMA_VERSION, 'unsupported schema version');
  check(Number.isSafeInteger(state.revision) && state.revision >= 0, 'invalid revision');
  check(Array.isArray(state.documents) && Array.isArray(state.nodes), 'documents and nodes must be arrays');
  const documents = new Map(), nodes = new Map(), identities = new Set();
  for (const document of state.documents) {
    keys(document, ['id','identity','title','createdAt','updatedAt'], 'document');
    keys(document.identity, ['libraryId','itemKey','attachmentKey'], 'document identity');
    const identity = document.identity;
    check(id(document.id) && !documents.has(document.id), 'duplicate/invalid document ID');
    check(Number.isSafeInteger(identity.libraryId) && identity.libraryId >= 0, 'invalid library ID');
    check(/^[A-Z0-9]{8}$/.test(identity.itemKey) && /^[A-Z0-9]{8}$/.test(identity.attachmentKey), 'invalid Zotero item/attachment key');
    const signature = JSON.stringify([identity.libraryId,identity.itemKey,identity.attachmentKey]);
    check(!identities.has(signature), 'duplicate document identity');
    check(text(document.title) && time(document.createdAt) && time(document.updatedAt), 'invalid document metadata');
    identities.add(signature); documents.set(document.id,document);
  }
  for (const node of state.nodes) {
    keys(node, ['id','documentId','parentId','concept','source','explanation','messages','view','createdAt','updatedAt','generation'], 'session');
    check(id(node.id) && !nodes.has(node.id) && !documents.has(node.id), 'duplicate/invalid session ID');
    check(documents.has(node.documentId) && (node.parentId === null || id(node.parentId)), 'invalid session parent/document');
    check(text(node.concept) && node.concept.trim().length > 0, 'empty concept');
    keys(node.source, ['selectedText','context','location'], 'source');
    keys(node.source.location, ['pageIndex','annotationKey'], 'source location');
    check(text(node.source.selectedText) && text(node.source.context), 'invalid source text');
    const {pageIndex,annotationKey} = node.source.location;
    check(pageIndex === null || (Number.isSafeInteger(pageIndex) && pageIndex >= 0), 'invalid page index');
    check(annotationKey === null || /^[A-Z0-9]{8}$/.test(annotationKey), 'invalid annotation key');
    keys(node.explanation, ['summary','detail','format'], 'explanation');
    check(text(node.explanation.summary) && text(node.explanation.detail) && ['markdown','plain'].includes(node.explanation.format), 'invalid explanation');
    keys(node.view, ['expanded','scrollTop','draft'], 'session view');
    check(typeof node.view.expanded === 'boolean' && Number.isFinite(node.view.scrollTop) && node.view.scrollTop >= 0 && text(node.view.draft), 'invalid session view');
    check(Array.isArray(node.messages) && time(node.createdAt) && time(node.updatedAt), 'invalid session metadata');
    const messageIds = new Set();
    for (const message of node.messages) {
      keys(message, ['id','role','content','createdAt'], 'message');
      check(id(message.id) && !messageIds.has(message.id) && ['user','assistant'].includes(message.role) && text(message.content) && time(message.createdAt), 'invalid/duplicate message');
      messageIds.add(message.id);
    }
    if (node.generation !== undefined) check(validGeneration(node.generation), 'invalid generation metadata');
    nodes.set(node.id,node);
  }
  for (const node of state.nodes) if (node.parentId !== null) {
    check(nodes.has(node.parentId) && nodes.get(node.parentId).documentId === node.documentId, 'missing or cross-document parent');
  }
  const resolved = new Set();
  for (const node of state.nodes) {
    const path = new Set();
    let current = node;
    while (current && !resolved.has(current.id)) {
      check(!path.has(current.id), 'cycle in session tree');
      path.add(current.id); current = current.parentId === null ? null : nodes.get(current.parentId);
    }
    for (const nodeId of path) resolved.add(nodeId);
  }
  const workspace = state.workspace;
  keys(workspace, ['activeDocumentId','pageNodeId','floatingNodeId','openNodeIds','view','treeSelectionId'], 'workspace');
  check(workspace.activeDocumentId === null || documents.has(workspace.activeDocumentId), 'invalid active document');
  for (const nodeId of [workspace.pageNodeId,workspace.floatingNodeId]) {
    check(nodeId === null || (nodes.has(nodeId) && nodes.get(nodeId).documentId === workspace.activeDocumentId), 'invalid active session');
  }
  // Page and floating view are independent pointers in the same document.
  // Expanding/navigating a page must not dismiss its floating companion.
  check(Array.isArray(workspace.openNodeIds) && new Set(workspace.openNodeIds).size === workspace.openNodeIds.length && workspace.openNodeIds.every(nodeId => nodes.has(nodeId)), 'invalid retained pages');
  check(['reading','knowledge'].includes(workspace.view), 'invalid workspace view');
  check(workspace.treeSelectionId === null || documents.has(workspace.treeSelectionId) || nodes.has(workspace.treeSelectionId), 'invalid knowledge-tree selection');
  return state;
}

export class KnowledgeTreeStore {
  #state; #storage; #limit = pLimit(1); #clock; #idFactory;
  static async open(storage, {clock = Date.now, idFactory = () => globalThis.crypto.randomUUID()} = {}) {
    if (typeof storage?.read !== 'function' || typeof storage?.write !== 'function') throw new TypeError('A JSON storage adapter is required');
    const stored = await storage.read();
    const state = stored === null ? emptyArchive() : validateArchive(stored);
    return new KnowledgeTreeStore(storage, state, clock, idFactory);
  }
  constructor(storage, state, clock, idFactory) {
    this.#storage = storage; this.#state = clone(validateArchive(state)); this.#clock = clock; this.#idFactory = idFactory;
  }
  snapshot() { return clone(this.#state); }
  getSession(nodeId) { return clone(this.#node(this.#state,nodeId)); }
  getKnowledgeForest() {
    const state = this.snapshot();
    const documents = new Map(state.documents.map(document => [document.id,{...document,children:[]} ]));
    const nodes = new Map(state.nodes.map(node => [node.id,{...node,children:[]} ]));
    for (const node of nodes.values()) {
      (node.parentId === null ? documents.get(node.documentId) : nodes.get(node.parentId)).children.push(node);
    }
    return [...documents.values()];
  }
  #node(state, nodeId) {
    const node = state.nodes.find(candidate => candidate.id === nodeId);
    if (!node) throw new Error('Session does not exist');
    return node;
  }
  #document(state, documentId) {
    const document = state.documents.find(candidate => candidate.id === documentId);
    if (!document) throw new Error('Document does not exist');
    return document;
  }
  #id(state, prefix) {
    const value = `${prefix}-${this.#idFactory()}`;
    if (!id(value) || [...state.documents,...state.nodes].some(record => record.id === value)) throw new Error('ID generator returned an invalid or duplicate ID');
    return value;
  }
  #mutate(operation) {
    return this.#limit(async () => {
      const next = this.snapshot();
      const result = operation(next);
      next.revision += 1;
      validateArchive(next);
      // Failed disk writes leave the committed in-memory snapshot untouched.
      await this.#storage.write(clone(next), {expectedRevision:this.#state.revision});
      this.#state = next;
      return result === undefined ? undefined : clone(result);
    });
  }
  flush() { return this.#limit(async () => {}); }
  registerDocument({libraryId,itemKey,attachmentKey,title = ''}) {
    return this.#mutate(state => {
      const existing = state.documents.find(document => document.identity.libraryId === libraryId && document.identity.itemKey === itemKey && document.identity.attachmentKey === attachmentKey);
      if (existing) return existing;
      const now = this.#clock();
      const document = {id:this.#id(state,'doc'),identity:{libraryId,itemKey,attachmentKey},title,createdAt:now,updatedAt:now};
      state.documents.push(document);
      return document;
    });
  }
  createSession(input) {
    const {documentId,parentId = null,concept,source = {},explanation = {},open = true} = clone(input);
    return this.#mutate(state => {
      const document = this.#document(state,documentId);
      if (parentId !== null && this.#node(state,parentId).documentId !== documentId) throw new Error('Session parent belongs to another document');
      const now = this.#clock();
      const node = {
        id:this.#id(state,'session'),documentId,parentId,concept,
        source:{selectedText:source.selectedText ?? concept,context:source.context ?? '',location:{pageIndex:source.location?.pageIndex ?? null,annotationKey:source.location?.annotationKey ?? null}},
        explanation:{summary:explanation.summary ?? '',detail:explanation.detail ?? '',format:explanation.format ?? 'markdown'},
        messages:[],view:{expanded:false,scrollTop:0,draft:''},createdAt:now,updatedAt:now
      };
      state.nodes.push(node);
      // A session is retained even when its floating view has never been expanded.
      state.workspace.openNodeIds.push(node.id);
      document.updatedAt = now;
      if (open) {
        if (parentId !== null) this.#node(state,parentId).view.expanded = true;
        Object.assign(state.workspace,{activeDocumentId:documentId,pageNodeId:parentId,floatingNodeId:node.id,view:'reading',treeSelectionId:node.id});
      }
      return node;
    });
  }
  #deletionPlan(state, nodeId) {
    const node = this.#node(state,nodeId), children = new Map();
    for (const candidate of state.nodes) {
      if (!children.has(candidate.parentId)) children.set(candidate.parentId,[]);
      children.get(candidate.parentId).push(candidate.id);
    }
    const nodeIds = [], stack = [nodeId];
    // Iterative traversal also handles deep trees without a recursion limit.
    while (stack.length) {
      const current = stack.pop(); nodeIds.push(current);
      for (const childId of children.get(current) ?? []) stack.push(childId);
    }
    return {nodeId,documentId:node.documentId,parentId:node.parentId,concept:node.concept,nodeIds,descendantCount:nodeIds.length-1};
  }
  getDeletionPlan(nodeId) { return clone(this.#deletionPlan(this.#state,nodeId)); }
  deleteSession(nodeId, {mode = 'subtree', expectedNodeIds} = {}) {
    if (!['node','subtree'].includes(mode)) return Promise.reject(new Error('Unknown deletion mode'));
    const expected = expectedNodeIds === undefined ? undefined : clone(expectedNodeIds);
    return this.#mutate(state => {
      const plan = this.#deletionPlan(state,nodeId);
      const deletedNodeIds = mode === 'subtree' ? plan.nodeIds : [nodeId];
      const removed = new Set(deletedNodeIds);
      // A new child created while the dialog was open must not be deleted unseen.
      if (expected !== undefined && (!Array.isArray(expected) || expected.length !== deletedNodeIds.length || new Set(expected).size !== expected.length || expected.some(value => !removed.has(value)))) {
        throw new Error('节点分支已变化，请重新确认删除范围。');
      }
      const now = this.#clock(), reparentedNodeIds = [];
      if (mode === 'node') for (const child of state.nodes) if (child.parentId === nodeId) {
        child.parentId = plan.parentId; child.updatedAt = now; reparentedNodeIds.push(child.id);
      }
      state.nodes = state.nodes.filter(node => !removed.has(node.id));
      const remainingById = new Map(state.nodes.map(node => [node.id,node]));
      const workspace = state.workspace;
      workspace.openNodeIds = workspace.openNodeIds.filter(value => !removed.has(value));
      if (removed.has(workspace.pageNodeId)) {
        const fallback = plan.parentId ?? [...workspace.openNodeIds].reverse().find(value => remainingById.get(value)?.documentId === workspace.activeDocumentId) ?? null;
        workspace.pageNodeId = fallback;
        if (fallback) {
          this.#node(state,fallback).view.expanded = true;
          if (!workspace.openNodeIds.includes(fallback)) workspace.openNodeIds.push(fallback);
        }
      }
      if (removed.has(workspace.floatingNodeId)) workspace.floatingNodeId = null;
      if (removed.has(workspace.treeSelectionId)) workspace.treeSelectionId = plan.parentId ?? plan.documentId;
      this.#document(state,plan.documentId).updatedAt = now;
      return {deletedNodeIds,reparentedNodeIds,documentId:plan.documentId,mode};
    });
  }
  sessionsForAnnotation({libraryId,attachmentKey,annotationKey}) {
    const documents=new Set(this.#state.documents.filter(doc=>doc.identity.libraryId===libraryId && doc.identity.attachmentKey===attachmentKey).map(doc=>doc.id));
    return clone(this.#state.nodes.filter(node=>documents.has(node.documentId) && node.source.location.annotationKey===annotationKey));
  }
  linkSessionAnnotation(nodeId,annotationKey) {
    if(!/^[A-Z0-9]{8}$/.test(annotationKey))return Promise.reject(new Error('Invalid annotation key'));
    return this.#mutate(state=>{
      const plan=this.#deletionPlan(state,nodeId),ids=new Set(plan.nodeIds),now=this.#clock();
      for(const node of state.nodes)if(ids.has(node.id) && node.source.location.annotationKey===null) {
        node.source.location.annotationKey=annotationKey;node.updatedAt=now;
      }
      return this.#node(state,nodeId);
    });
  }
  deleteAnnotationSessions(identities) {
    const captured=clone(identities);
    if(!Array.isArray(captured) || captured.some(ref=>!Number.isSafeInteger(ref.libraryId) || ref.libraryId<0 || !/^[A-Z0-9]{8}$/.test(ref.attachmentKey) || !/^[A-Z0-9]{8}$/.test(ref.annotationKey)))return Promise.reject(new Error('Invalid annotation identity'));
    return this.#mutate(state=>{
      const documents=new Map(state.documents.map(doc=>[doc.id,doc]));
      const roots=state.nodes.filter(node=>captured.some(ref=>{
        const identity=documents.get(node.documentId).identity;
        return identity.libraryId===ref.libraryId && identity.attachmentKey===ref.attachmentKey && node.source.location.annotationKey===ref.annotationKey;
      }));
      const removed=new Set(),byId=new Map(state.nodes.map(node=>[node.id,node]));
      for(const root of roots)for(const nodeId of this.#deletionPlan(state,root.id).nodeIds)removed.add(nodeId);
      const parentFor=nodeId=>{
        let node=byId.get(nodeId);
        while(node && removed.has(node.id))node=byId.get(node.parentId);
        return node?.id ?? null;
      };
      const workspace=state.workspace,now=this.#clock();
      workspace.openNodeIds=workspace.openNodeIds.filter(nodeId=>!removed.has(nodeId));
      if(removed.has(workspace.pageNodeId)) {
        workspace.pageNodeId=parentFor(workspace.pageNodeId) ?? [...workspace.openNodeIds].reverse().find(nodeId=>byId.get(nodeId)?.documentId===workspace.activeDocumentId) ?? null;
        if(workspace.pageNodeId)byId.get(workspace.pageNodeId).view.expanded=true;
      }
      if(removed.has(workspace.floatingNodeId))workspace.floatingNodeId=null;
      if(removed.has(workspace.treeSelectionId))workspace.treeSelectionId=parentFor(workspace.treeSelectionId) ?? byId.get(workspace.treeSelectionId).documentId;
      const documentIds=[...new Set([...removed].map(nodeId=>byId.get(nodeId).documentId))];
      for(const documentId of documentIds)documents.get(documentId).updatedAt=now;
      state.nodes=state.nodes.filter(node=>!removed.has(node.id));
      return {deletedNodeIds:[...removed],reparentedNodeIds:[],documentIds,mode:'subtree'};
    });
  }
  setExplanation(nodeId, patch) {
    const captured = clone(patch);
    keys(captured, ['summary','detail','format'], 'explanation patch');
    return this.#mutate(state => {
      const node = this.#node(state,nodeId);
      Object.assign(node.explanation,captured);
      // Invalidate only metadata for replaced text, never remove existing answers or branches.
      for (const part of ['summary','detail']) if (part in captured && node.generation) delete node.generation[part];
      if (node.generation && !Object.keys(node.generation).length) delete node.generation;
      node.updatedAt = this.#clock();
      return node;
    });
  }
  appendMessage(nodeId, {role,content}) {
    return this.#mutate(state => {
      const node = this.#node(state,nodeId);
      const now = this.#clock();
      const message = {id:`message-${this.#idFactory()}`,role,content,createdAt:now};
      node.messages.push(message); node.updatedAt = now;
      return message;
    });
  }
  saveSessionView(nodeId, patch) {
    const captured = clone(patch);
    keys(captured, ['expanded','scrollTop','draft'], 'view patch');
    return this.#mutate(state => {
      const node = this.#node(state,nodeId);
      Object.assign(node.view,captured); node.updatedAt = this.#clock();
      return node;
    });
  }
  openSession(nodeId, mode = 'page') {
    if (!['page','floating'].includes(mode)) return Promise.reject(new Error('Unknown session display mode'));
    return this.#mutate(state => {
      const node = this.#node(state,nodeId);
      if (mode === 'page') node.view.expanded = true;
      if (mode === 'floating' && node.parentId !== null) this.#node(state,node.parentId).view.expanded = true;
      if (!state.workspace.openNodeIds.includes(nodeId)) state.workspace.openNodeIds.push(nodeId);
      Object.assign(state.workspace,{activeDocumentId:node.documentId,pageNodeId:mode === 'page' ? nodeId : node.parentId,floatingNodeId:mode === 'floating' ? nodeId : state.workspace.activeDocumentId === node.documentId ? state.workspace.floatingNodeId : null,view:'reading',treeSelectionId:nodeId});
      return state.workspace;
    });
  }
  openDocument(documentId) {
    return this.#mutate(state => {
      this.#document(state,documentId);
      Object.assign(state.workspace,{activeDocumentId:documentId,pageNodeId:null,floatingNodeId:null,view:'reading',treeSelectionId:documentId});
      return state.workspace;
    });
  }
  closeFloating() {
    return this.#mutate(state => { state.workspace.floatingNodeId = null; });
  }
  returnToParent() {
    return this.#mutate(state => {
      const workspace = state.workspace;
      if (workspace.pageNodeId !== null) workspace.pageNodeId = this.#node(state,workspace.pageNodeId).parentId;
      workspace.view = 'reading';
      // Navigation changes only workspace pointers; children, drafts and pages remain.
      return workspace;
    });
  }
  showKnowledgeTree(selectionId) {
    return this.#mutate(state => {
      const selection = selectionId === undefined ? (state.workspace.floatingNodeId ?? state.workspace.pageNodeId ?? state.workspace.activeDocumentId) : selectionId;
      Object.assign(state.workspace,{view:'knowledge',treeSelectionId:selection});
      return state.workspace;
    });
  }
  resumeReading() {
    return this.#mutate(state => { state.workspace.view = 'reading'; return state.workspace; });
  }
}
