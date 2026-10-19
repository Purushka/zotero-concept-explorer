import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const sha=b=>createHash('sha256').update(b).digest('hex'),xpi=join(root,'dist','concept-explorer-'+version+'.xpi');
async function assets(){const values={};for(const file of ['panel.js','runtime.js','panel.css','panel.html'])values['content/'+file]=sha(await readFile(join(root,'dist/addon/content',file)));return values;}
const testedAssets=await assets(),packageSHA256=sha(await readFile(xpi));
async function run(file){
 const child=spawn(process.execPath,[join(root,file)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
 child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
 const code=await new Promise((res,rej)=>{child.once('error',rej);child.once('exit',res);});
 if(code!==0)throw Error(file+' failed:\n'+out+err);
 const result=JSON.parse(out.trim().split(/\r?\n/).at(-1));
 const saved=JSON.parse(await readFile(join(result.artifact,'result.json'),'utf8'));
 Object.assign(saved,{version,packageSHA256,testedAssets});
 await writeFile(join(result.artifact,'result.json'),JSON.stringify(saved,null,2)+'\n');
 return {...saved,artifact:result.artifact};
}
const [original,deletion]=await Promise.all([run('tests/ui-checks.cjs'),run('tests/node-deletion-ui.cjs')]);
assert.deepEqual(await assets(),testedAssets,'Built assets changed while testing');assert.equal(sha(await readFile(xpi)),packageSHA256);
assert.equal(original.passed,32);assert(deletion.passed>=11);
const report={version,packageSHA256,testedAssets,original,deletion,realModelCalls:0,installedUserProfileModified:false};
await writeFile(join(root,'.test-artifacts','ui-validation-'+version+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({version,originalChecks:original.passed,deletionChecks:deletion.passed,artifacts:[original.artifact,deletion.artifact],packageSHA256}));
