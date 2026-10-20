import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,extname} from 'node:path';

const chrome=['google-chrome','chromium','chromium-browser'].find(binary=>spawnSync('which',[binary]).status===0);
test('Real Chrome authenticates asynchronously and opens the dashboard, with no URL credentials',async()=>{
 assert.ok(chrome,'Chromium required');
 const fixture={
 access_token:'integration-access',refresh_token:'integration-refresh',expires_in:3600,
 user:{id:'00000000-0000-4000-8000-000000000001',email:'demo@example.com',app_metadata:{css_role:'president'}}
 };
 const injection=`<script>
 window.fetch=async (url,options={})=>{
   const u=new URL(String(url));
   if(u.pathname.endsWith('/auth/v1/token'))return Response.json(${JSON.stringify(fixture)});
   if(u.pathname.endsWith('/auth/v1/user'))return Response.json(${JSON.stringify(fixture.user)});
   if(u.pathname.includes('/rest/v1/'))return Response.json([]);
   return Response.json({message:'not found'},{status:404});
 };
 window.addEventListener('load',()=>{
   setTimeout(()=>{
     const form=document.querySelector('#login-form');
     form.elements.email.value='demo@example.com';
     form.elements.password.value='fixture-do-not-use';
     form.requestSubmit();
   },100);
   setTimeout(()=>{document.body.setAttribute('data-test-search',location.search)},2100);
 });
 </script>`;
 const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(!['/','/index.html','/app.js','/style.css'].includes(url.pathname)){response.writeHead(404);response.end();return}
  const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
  let body=readFileSync(resolve(path),'utf8');
  if(path==='index.html')body=body.replace('<script>\n/* Safe',injection+'<script>\n/* Safe');
  response.setHeader('Content-Type',extname(path)==='.css'?'text/css':extname(path)==='.js'?'text/javascript':'text/html');
  response.end(body);
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{
  const url='http://127.0.0.1:'+server.address().port+'/';
  const out=await new Promise((done,fail)=>{
   const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--virtual-time-budget=4500','--dump-dom',url],{stdio:['ignore','pipe','pipe']});
   let data='',error='';
   child.stdout.on('data',v=>data+=v);
   child.stderr.on('data',v=>error+=v);
   const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
   child.on('close',code=>{clearTimeout(timer);code===0?done(data):fail(new Error('chrome failed '+error.slice(-1200)))});
   child.on('error',fail);
  });
  assert.match(out,/id="app" class="shell"/);
  assert.match(out,/營運總覽/);
  assert.match(out,/data-test-search=""/);
  assert.doesNotMatch(out,/登入服務無法連線|登入後初始化失敗/);
 }finally{await new Promise(done=>server.close(done))}
});
