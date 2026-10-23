// Local mock only. No remote requests or genuine credentials are used.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {formulaText} from '../fixtures/formulas.mjs';
const root=path.resolve(process.argv[2] ?? '');
if(!path.basename(root).startsWith('gecko-rollback-'))throw Error('Expected isolated gecko-rollback directory');
const local=n=>path.join(root,n),calls=[];let writing=Promise.resolve();
const publish=()=>{writing=writing.then(async()=>{await fs.writeFile(local('relay-calls.tmp'),JSON.stringify(calls));await fs.rename(local('relay-calls.tmp'),local('relay-calls.json'));});return writing;};
const summary='这是**测试简述**，结合合成论文中的 [[条件概率]]。公式 $p(x)=x^2$。';
const detail='## 详细解释\n\n根据合成论文背景说明**后验分布**的作用。\n\n'+formulaText+'\n\n必要概念 [[贝叶斯定理]]。';
const sse=(v,e='')=>(e?'event: '+e+'\n':'')+'data: '+JSON.stringify(v)+'\n\n';
const server=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
  const protocol=req.url.endsWith('/responses')?'responses':req.url.endsWith('/messages')?'anthropic':'chat';
  const sys=body.instructions ?? body.system ?? body.messages?.[0]?.content ?? '';
  const combined=String(sys).includes('返回 JSON 对象'),text=combined?JSON.stringify({summary,detail}):'这是**测试追问**回答，涉及 [[条件独立]]。\n\n'+formulaText;
  const mode=JSON.parse(await fs.readFile(local('relay-mode.json'),'utf8')).mode;
  const call={path:req.url,protocol,combined,model:body.model,body,stream:body.stream===true,completed:false,closed:false};calls.push(call);await publish();
  res.on('close',()=>{call.closed=true;void publish();});
  res.setHeader('Content-Type','text/event-stream');
  if(protocol==='anthropic')res.write(sse({type:'message_start',message:{usage:{input_tokens:80,cache_read_input_tokens:80}}},'message_start'));
  const chunks=text.match(/.{1,12}|\n/g);for(const chunk of chunks){if(res.destroyed)return;
   if(protocol==='responses')res.write(sse({type:'response.output_text.delta',delta:chunk},'response.output_text.delta'));
   else if(protocol==='anthropic')res.write(sse({type:'content_block_delta',index:0,delta:{type:'text_delta',text:chunk}},'content_block_delta'));
   else res.write(sse({choices:[{index:0,delta:{content:chunk},finish_reason:null}]}));
   await new Promise(r=>setTimeout(r,mode==='slow'?200:80));if(mode==='truncate'){res.end();return;}
  }
  if(protocol==='responses')res.write(sse({type:'response.completed',response:{status:'completed',output_text:text,usage:{input_tokens:160,output_tokens:40,input_tokens_details:{cached_tokens:80}}}},'response.completed'));
  else if(protocol==='anthropic')res.write(sse({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:40}},'message_delta')+sse({type:'message_stop'},'message_stop'));
  else res.write(sse({choices:[{index:0,delta:{},finish_reason:'stop'}]})+sse({choices:[],usage:{prompt_tokens:160,completion_tokens:40,prompt_tokens_details:{cached_tokens:80}}})+'data: [DONE]\n\n');
  call.completed=true;await publish();res.end();
 }catch(error){if(!res.headersSent)res.statusCode=500;res.end(JSON.stringify({error:{message:'Local test mock failure'}}));}
});
await fs.mkdir(root,{recursive:true});await fs.writeFile(local('relay-mode.json'),JSON.stringify({mode:'normal'}));await publish();
await new Promise(r=>server.listen(0,'127.0.0.1',r));await fs.writeFile(local('relay.json'),JSON.stringify({rootURL:'http://127.0.0.1:'+server.address().port}));
console.log('Isolated relay ready');
const watcher=setInterval(async()=>{if(await fs.stat(local('stop-relay')).then(()=>true,()=>false)){clearInterval(watcher);server.close();server.closeAllConnections();}},300);

