import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const memory = new Map();
globalThis.sessionStorage = {
 getItem(k){return memory.get(k)||null;},
 setItem(k,v){memory.set(k,v);},
 removeItem(k){memory.delete(k);}
};
const src=readFileSync('api.js','utf8').replace(
 "import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';",
 "const SUPABASE_URL='https://test.example.supabase.co'; const SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';"
);
const {db}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const calls=[];
let reject=false;
globalThis.fetch=async(url,options)=>{
 calls.push({url,options});
 const path=new URL(url).pathname;
 if(path.endsWith('/token')){
  if(reject)return Response.json({code:'invalid_credentials'},{status:400});
  return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{email:'fixture@example.org',app_metadata:{css_role:'admin'}}});
 }
 if(path.endsWith('/user'))return Response.json({email:'fixture@example.org',app_metadata:{css_role:'admin'}});
 if(path.endsWith('/css_members'))return Response.json([{id:'fixture-id'}]);
 if(path.endsWith('/logout'))return new Response('',{status:204});
 return Response.json({message:'invalid endpoint'},{status:404});
};
test('login uses POST body, never URL query parameters',async()=>{
 const result=await db.auth.signInWithPassword({email:'fixture@example.org',password:'fixture-input'});
 assert.equal(result.error,null);
 assert.equal(result.data.user.app_metadata.css_role,'admin');
 const req=calls[0];
 assert.equal(req.options.method,'POST');
 assert.equal(new URL(req.url).searchParams.get('grant_type'),'password');
 assert.equal(new URL(req.url).searchParams.has('email'),false);
 assert.equal(JSON.parse(req.options.body).email,'fixture@example.org');
 assert.equal(JSON.parse(req.options.body).password,'fixture-input');
 assert.equal(req.options.referrerPolicy,'no-referrer');
});
test('session and RLS data queries use Authorization header',async()=>{
 const session=await db.auth.getSession();
 assert.equal(session.error,null);
 const result=await db.from('css_members').select('*').order('created_at').range(0,999);
 assert.equal(result.error,null);
 assert.equal(result.data.length,1);
 const req=calls.at(-1);
 assert.equal(req.options.headers.Authorization,'Bearer fixture-access');
 assert.equal(req.options.headers.Range,'0-999');
});
test('incorrect password returns an error without exposing it in URL',async()=>{
 reject=true;
 const result=await db.auth.signInWithPassword({email:'fixture@example.org',password:'bad-fixture'});
 assert.notEqual(result.error,null);
 assert.match(result.error.message,/不正確/);
 assert.doesNotMatch(calls.at(-1).url,/bad-fixture/);
});
