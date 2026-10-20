import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {resolve,extname} from 'node:path';

test('Real Chrome starts login page, activates form, and runs without module exceptions', async () => {
  const browser = ['google-chrome','chromium','chromium-browser'].find(name =>
    spawnSync('which',[name],{encoding:'utf8'}).status===0
  );
  assert.ok(browser,'Chrome/Chromium must be available to validate deployment.');
  const allowed=new Set(['/','/index.html','/app.js','/style.css','/config.js']);
  const server=createServer((req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(!allowed.has(path)){res.writeHead(404);res.end('Not found');return;}
    const filename=resolve(path==='/'?'index.html':path.slice(1));
    const mime={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'}[extname(filename)];
    res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});
    res.end(readFileSync(filename));
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/';
    const html=await new Promise((done,fail)=>{
      const child=spawn(browser,[
        '--headless=new','--disable-gpu','--no-sandbox','--disable-dev-shm-usage',
        '--disable-background-networking','--no-first-run',
        '--virtual-time-budget=5000','--dump-dom',url
      ],{stdio:['ignore','pipe','pipe']});
      let out='',err='';
      child.stdout.on('data',chunk=>out+=chunk.toString());
      child.stderr.on('data',chunk=>err+=chunk.toString());
      const watchdog=setTimeout(()=>child.kill('SIGKILL'),25000);
      child.on('error',e=>{clearTimeout(watchdog);fail(e);});
      child.on('close',code=>{clearTimeout(watchdog);if(code===0)done(out);else fail(new Error('Chrome code '+code+': '+err.slice(-1200)));});
    });
    const button=html.match(/<button[^>]*id="login-button"[^>]*>/);
    assert.ok(button,'Login button should be rendered');
    assert.doesNotMatch(button[0],/\bdisabled(?:=|\s|>)/,'Login button must be enabled by app bootstrap');
    assert.match(html,/id="login-button"[^>]*>安全登入/);
    assert.match(html,/<p id="login-error" class="error" role="alert"><\/p>/,
      'No initialization error may be shown after bootstrap');
    assert.doesNotMatch(html,/type="module" src="\.\/app.js"/);
  } finally {
    await new Promise(done=>server.close(done));
  }
});
