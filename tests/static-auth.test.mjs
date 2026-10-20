import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('login form cannot navigate to GET URL',()=>{
 const html=readFileSync('index.html','utf8');
 assert.match(html,/<form id="login-form" method="post"/);
 assert.match(html,/event\.preventDefault\(\)/);
 assert.match(html,/id="login-button" disabled/);
 assert.match(html,/history\.replaceState/);
});
test('application boots from a self-contained same-origin classic script',()=>{
 const app=readFileSync('app.js','utf8');
 assert.ok(!app.includes("import { db } from"));
 assert.ok(app.includes('window.PUICSA_READY=true'));
 assert.match(app,/grant_type=password/);
 assert.match(app,/referrerPolicy:'no-referrer'/);
 const html=readFileSync('index.html','utf8');
 assert.ok(html.includes('<script defer src="./app.js?v='));
 assert.doesNotMatch(app,/esm\.sh|unpkg\.com/);
 const api=readFileSync('api.js','utf8');
 assert.match(api,/grant_type=password/);
 assert.match(api,/method: body === undefined \? 'GET' : 'POST'/);
 assert.match(api,/referrerPolicy:'no-referrer'/);
});
