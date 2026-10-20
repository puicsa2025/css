'use strict';
// Public client configuration only. NEVER use Supabase secret or service_role API keys.
const SUPABASE_URL = 'https://kcssbyfkzhtjrouwcufc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Q86TNLgHRKvHU3VF27cKtQ_1LnvZ0AQ';

const $=sel=>document.querySelector(sel);
const params=new URLSearchParams(location.search),eventId=params.get('event');
const message=(str,bad=false)=>{$('#register-message').textContent=str;$('#register-message').className=bad?'error':'success'};
async function rpc(name,body){
 const r=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},
  body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer'
 });
 const raw=await r.text();let output;
 try{output=JSON.parse(raw)}catch{output=null}
 if(!r.ok)throw Error(output?.message||'伺服器回應異常（HTTP '+r.status+'）');
 return output;
}
function validId(id){return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||'')}
async function boot(){
 if(!validId(eventId)){message('報名連結不正確。',true);$('#event-info').textContent='請向主辦單位索取正確 QR Code。';return}
 try{
  const data=await rpc('css_public_event',{p_event_id:eventId});
  const e=data?.[0];if(!e){message('活動未開放報名或已截止。',true);$('#event-info').textContent='請聯絡主辦單位。';return}
  $('#event-title').textContent=e.title;
  const pieces=['時間：'+new Date(e.starts_at).toLocaleString('zh-TW')];
  if(e.location)pieces.push('地點：'+e.location);
  if(e.capacity)pieces.push('名額：'+e.registered+' / '+e.capacity);
  if(e.description)pieces.push(e.description);
  $('#event-info').textContent=pieces.join('　｜　');
  if(e.capacity&&Number(e.registered)>=e.capacity){message('活動名額已滿。',true);return}
  $('#registration-form').hidden=false;
 }catch(err){message('目前無法取得活動資訊：'+err.message,true)}
}
$('#registration-form').onsubmit=async event=>{
 event.preventDefault();
 const form=event.currentTarget,button=$('#register-btn');
 button.disabled=true;button.textContent='報名送出中…';
 try{
  const payload=Object.fromEntries(new FormData(form));
  payload.p_event_id=eventId;
  const result=await rpc('css_register_event',payload);
  message(String(result||'已提交報名'));
  if(result==='報名成功'){$('#registration-form').hidden=true}
 }catch(err){message('報名失敗：'+err.message,true)}
 finally{button.disabled=false;button.textContent='確認報名'}
};
void boot();
