import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join,basename,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {validateArchive} from '../../src/knowledge-tree-store.mjs';
const project=resolve(import.meta.dirname,'../..'),root=resolve(process.argv[2] ?? ''),phase=process.argv[3] ?? 'first';
if(!root.startsWith(join(project,'.test-artifacts')+sep) || !basename(root).startsWith('gecko-rollback-'))throw Error('Refusing non-test directory');
const pkg=JSON.parse(await readFile(join(project,'package.json'),'utf8')),manifest=JSON.parse(await readFile(join(project,'addon/manifest.json'),'utf8'));
const xpi=join(project,'dist','concept-explorer-'+pkg.version+'.xpi'),bytes=await readFile(xpi);
await mkdir(join(root,'profile','extensions'),{recursive:true});await mkdir(join(root,'data'),{recursive:true});await mkdir(join(root,'harness'),{recursive:true});
const template=await readFile(join(import.meta.dirname,'bootstrap.js'),'utf8');await writeFile(join(root,'harness','bootstrap.js'),template.replace('__ROOT_JSON__',JSON.stringify(root)));
await writeFile(join(root,'harness','manifest.json'),JSON.stringify({manifest_version:2,name:'Concept rollback isolated host tests',version:'1.0.0',applications:{zotero:{...manifest.applications.zotero,id:'concept-rollback-test@local.research'}}}));
await writeFile(join(root,'profile','extensions','concept-rollback-test@local.research'),join(root,'harness'));
await copyFile(xpi,join(root,'profile','extensions','concept-explorer@local.research.xpi'));await copyFile(join(import.meta.dirname,'fixture.pdf'),join(root,'fixture.pdf'));
if(phase==='first') {
 await writeFile(join(root,'profile','prefs.js'),[
  ['extensions.zotero.firstRun2',false],['extensions.zotero.firstRun.skipFirefoxProfileAccessCheck',true],['extensions.zotero.sync.autoSync',false],['extensions.autoDisableScopes',0],['extensions.logging.enabled',true],['browser.dom.window.dump.enabled',true],['app.update.auto',false],['extensions.zotero.conceptExplorer.language','zh-CN']
 ].map(([k,v])=>'user_pref('+JSON.stringify(k)+', '+JSON.stringify(v)+');').join('\n')+'\n');
 const generation={summary:{key:'a'.repeat(64),metrics:{source:'network',requestId:'synthetic-legacy',elapsedMs:120,firstTextMs:50,completedAt:1000,usage:{inputTokens:120,outputTokens:40,cachedInputTokens:null}}},detail:{key:'b'.repeat(64),metrics:{source:'cache',requestId:'synthetic-legacy-detail',elapsedMs:0,firstTextMs:null,completedAt:1000,usage:{inputTokens:0,outputTokens:0,cachedInputTokens:0}}}};
 const session=(id,parentId)=>({id,documentId:'legacy-doc',parentId,concept:id,source:{selectedText:id,context:'Synthetic legacy paper context',location:{pageIndex:0,annotationKey:null}},explanation:{summary:'Legacy retained summary',detail:'## Legacy complete detail\n\nSynthetic archived explanation.',format:'markdown'},messages:[{id:'legacy-user',role:'user',content:'Saved question',createdAt:1000},{id:'legacy-assistant',role:'assistant',content:'Saved full answer',createdAt:1001}],view:{expanded:true,scrollTop:456,draft:'Legacy unsent draft'},createdAt:1000,updatedAt:1001,generation:structuredClone(generation)});
 const archive=validateArchive({version:1,revision:9,documents:[{id:'legacy-doc',identity:{libraryId:1,itemKey:'LEGACY01',attachmentKey:'LEGPDF01'},title:'Synthetic legacy paper',createdAt:1000,updatedAt:1001}],nodes:[session('legacy-parent',null),session('legacy-child','legacy-parent')],workspace:{activeDocumentId:'legacy-doc',pageNodeId:'legacy-parent',floatingNodeId:'legacy-child',openNodeIds:['legacy-parent','legacy-child'],view:'reading',treeSelectionId:'legacy-child'}});
 await mkdir(join(root,'data','concept-explorer'),{recursive:true});await writeFile(join(root,'data','concept-explorer','knowledge-tree.json'),JSON.stringify(archive));await writeFile(join(root,'legacy-expected.json'),JSON.stringify(archive));
}
await writeFile(join(root,'phase.json'),JSON.stringify({phase}));
await writeFile(join(root,'package-under-test.json'),JSON.stringify({packaged:true,expectedPluginVersion:pkg.version,packageSHA256:createHash('sha256').update(bytes).digest('hex'),expectedZoteroVersion:'10.0.6'}));
console.log(root);
