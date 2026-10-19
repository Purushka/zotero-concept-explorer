import {build} from 'esbuild';
import JSZip from 'jszip';
import {mkdir,cp,readdir,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const manifest=JSON.parse(await readFile(join(root,'addon','manifest.json'),'utf8'));
if(pkg.version!==manifest.version)throw new Error('Source and addon versions differ');
const name='concept-explorer-'+pkg.version+'.xpi',file=join(root,'dist',name);
const exists=path=>access(path).then(()=>true,()=>false);
if(await exists(file)) {
  const published=await exists(join(root,'dist','concept-explorer-'+pkg.version+'-release.zip'));
  if(published || !process.argv.includes('--replace-test-build'))throw new Error('Existing package preserved. Bump the version, or explicitly replace an unpublished test build.');
}
const target=join(root,'dist','addon');
await mkdir(target,{recursive:true});
await cp(join(root,'addon'),target,{recursive:true});
await mkdir(join(target,'content','vendor'),{recursive:true});
const bundles=await Promise.all([
 build({entryPoints:[join(root,'src','runtime.mjs')],outfile:join(target,'content','runtime.js'),bundle:true,metafile:true,format:'iife',globalName:'ConceptExplorerRuntime',target:'firefox128',platform:'browser',legalComments:'inline'}),
 build({entryPoints:[join(root,'src','panel.mjs')],outfile:join(target,'content','panel.js'),bundle:true,metafile:true,format:'iife',target:'firefox128',platform:'browser',external:['katex']})
]);
await mkdir(join(root,'.test-artifacts','build'),{recursive:true});
await writeFile(join(root,'.test-artifacts','build','metafiles.json'),JSON.stringify(bundles.map(b=>b.metafile)));
for(const name of ['markdown-it.js','floating-ui.core.js','floating-ui.dom.js','interact.js'])await cp(join(root,'vendor',name),join(target,'content','vendor',name));
await cp(join(root,'vendor','katex'),join(target,'content','vendor','katex'),{recursive:true});
await mkdir(join(target,'licenses'),{recursive:true});
for(const name of await readdir(join(root,'vendor')))if(name.endsWith('.LICENSE') || name==='NOTICE.md')await cp(join(root,'vendor',name),join(target,'licenses',name));
// Collect exact npm bundle licenses as well as the pinned source/build dependencies.
const packageRoots=new Set();
for(const name of Object.keys(pkg.devDependencies)) {
 // Resolve the actual entry before walking up to package metadata. This also
 // handles pnpm links reached through a Windows workspace directory junction.
 let dir=dirname(fileURLToPath(import.meta.resolve(name))),found=false;
 while(dirname(dir)!==dir) {
  try {const info=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(info.name===name){packageRoots.add(dir);found=true;break;}}catch{}
  dir=dirname(dir);
 }
 if(!found)throw new Error('Missing dependency metadata: '+name);
}
for(const bundle of bundles)for(const input of Object.keys(bundle.metafile.inputs))if(input.replaceAll('\\','/').startsWith('node_modules/')){
 let dir=dirname(resolve(root,input));
 while(dir.startsWith(root+sep)) {
  try {const info=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(info.name && info.version){packageRoots.add(dir);break;}}catch{}
  dir=dirname(dir);
 }
}
const packages=[];
for(const dir of [...packageRoots].sort()){
 const info=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
 const licenseDir=join(target,'licenses','npm',info.name.replaceAll('/','__')+'-'+info.version);await mkdir(licenseDir,{recursive:true});
 const files=[];
 for(const item of await readdir(dir,{withFileTypes:true}))if(item.isFile() && /^(licen[sc]e|copying|notice)([.-].*)?$/i.test(item.name)){await cp(join(dir,item.name),join(licenseDir,item.name));files.push(item.name);}
 if(!files.length)throw new Error('Missing npm license: '+info.name);
 packages.push({name:info.name,version:info.version,license:info.license,repository:info.repository,files});
}
await writeFile(join(target,'licenses','npm','index.json'),JSON.stringify(packages,null,2)+'\n');
for(const name of ['LICENSE','README.md','VALIDATION.md'])await cp(join(root,name),join(target,name));
// Explicit editable-source whitelist; never include profiles or runtime data.
for(const dir of ['src','tests','scripts','vendor','addon'])await cp(join(root,dir),join(target,'source',dir),{recursive:true});
for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'])if(await exists(join(root,name)))await cp(join(root,name),join(target,'source',name));
const zip=new JSZip();
async function add(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Symlink in addon');if(entry.isDirectory())await add(path);else zip.file(relative(target,path).replaceAll('\\','/'),await readFile(path));}}
await add(target);
const data=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
await writeFile(file,data,{flag:await exists(file)?'w':'wx'});
const hash=createHash('sha256').update(data).digest('hex');
await writeFile(file+'.sha256',hash+'  '+name+'\n');
console.log(JSON.stringify({file,bytes:data.length,sha256:hash,npmLicenses:packages.map(p=>p.name)}));
