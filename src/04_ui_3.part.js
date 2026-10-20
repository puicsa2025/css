;toast('學期已'+(next==='closed'?'封存':'重新開啟'));
}
function showEventQr(id){
 const event=(data.events||[]).find(x=>x.id===id);
 if(!event)return;
 const url=new URL('./register.html',location.href);url.searchParams.set('event',id);
 const qr='https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='+encodeURIComponent(url.href);
 const overlay=document.createElement('dialog');
 overlay.innerHTML='<div class="qr-modal"><h3>'+esc(event.title)+' 報名</h3><p>將此網址或 QR Code 提供給參加者。QR 圖由外部 QR 服務產生，僅傳送公開報名網址。</p><img width="220" height="220" alt="活動報名 QR Code" src="'+esc(qr)+'"><input readonly value="'+esc(url.href)+'"><div class="form-actions"><button class="secondary" id="qr-copy">複製連結</button><button class="secondary" id="qr-close">關閉</button></div></div>';
 document.body.append(overlay);overlay.showModal();
 overlay.querySelector('#qr-copy').onclick=async()=>{try{await navigator.clipboard.writeText(url.href);toast('報名連結已複製')}catch{toast('請手動複製連結',true)}};
 overlay.querySelector('#qr-close').onclick=()=>overlay.close();
 overlay.onclose=()=>overlay.remove();
}
async function setDate(which,id,key){
 if(!confirm('確認執行此操作？'))return;
 const {error}=await db.from(cfg[which].table).update({[key]:new Date().toISOString()}).eq('id',id);
 if(error)return toast(error.message,true);
 await refresh();toast('狀態已更新');
}
function printReceipt(id){
 const p=(data.payments||[]).find(x=>x.id===id);
 if(!p)return;
 const member=mapMember(p.member_id);
 const html='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>PUICSA 繳費收據</title><style>body{font:16px sans-serif;max-width:650px;margin:60px auto;line-height:2.4}h1{font-size:24px;border-bottom:3px solid #173b60}strong{font-size:24px}@media print{button{display:none}}</style><h1>PUICSA 系學會繳費收據</h1><p>收據編號：'+esc(p.id)+'<br>會員：'+esc(member)+'<br>學年度：'+esc(p.academic_year)+'／第'+esc(p.semester)+'學期<br>日期：'+esc(p.paid_at)+'<br>付款方式：'+esc(p.payment_method)+'</p><strong>實收金額：'+esc(fmt(p.amount))+'</strong><p>本收據依系統登錄資料產製，必要時請向總務確認入帳。</p><button onclick="print()">列印／另存 PDF</button></html>';
 const win=window.open('','_blank');
 if(!win)return toast('瀏覽器封鎖了收據視窗，請允許快顯視窗',true);
 win.opener=null;win.document.write(html);win.document.close();
}
function csvRows(text){
 const grid=[],row=[];let v='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){v+='"';i++}else if(c==='"')quoted=false;else v+=c}
  else if(c==='"')quoted=true;
  else if(c===','){row.push(v);v=''}
  else if(c==='\n'){row.push(v.replace(/\r$/,''));grid.push([...row]);row.length=0;v=''}
  else v+=c;
 }
 if(v||row.length){row.push(v);grid.push([...row])}
 return grid;
}
async function importMembers(e){
 const file=e.target.files?.[0];if(!file)return;
 if(file.size>1024*1024)return toast('CSV 檔案上限 1 MB，請分批處理',true);
 const values=csvRows((await file.text()).replace(/^\uFEFF/,''));
 const headers=values.shift()?.map(v=>v.trim());
 const permitted=['student_id','name','department','class_name','year_level','status'];
 if(!headers?.includes('student_id')||!headers.includes('name'))return toast('CSV 需要 student_id、name 欄位',true);
 const rows=values.filter(x=>x.some(y=>y.trim())).map(cols=>{
  const o={};headers.forEach((h,i)=>{if(permitted.includes(h)&&cols[i]!==undefined)o[h]=cols[i].trim()});
  if(!o.year_level)delete o.year_level;else o.year_level=Number(o.year_level);
  if(!o.status)delete o.status;return o;
 });
 if(rows.length>300)return toast('一次最多匯入300人',true);
 if(!confirm('確定匯入 '+rows.length+' 位會員？已存在的學號會被資料庫拒絕。'))return;
 const {error}=await db.from('css_members').insert(rows);
 if(error)return toast('匯入失敗：'+error.message,true);
 await refresh();toast('會員批次匯入成功');
}
async function staffRpc(name,payload={}){
 const access=await token();
 const result=await fetch(SUPABASE_URL+'/rest/v1/rpc/'+name,{
  method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+access,'Content-Type':'application/json'},
  body:JSON.stringify(payload),cache:'no-store',referrerPolicy:'no-referrer'
 });
 let body;
 try{body=await result.json()}catch{body=null}
 if(!result.ok)throw Error(body?.message||'伺服器無法完成請求（'+result.status+'）');
 return body;
}
async function renderStaff(){
 $('#page-title').textContent='幹部與權限管理';
 $('#content').innerHTML='<p class="section-intro">只有會長、副會長能指派職務。資訊部可檢視幹部清單；建立新 Auth 使用者仍需於 Supabase 安全管理介面進行。</p><div class="panel"><h3>正在讀取授權帳號…</h3></div>';
 try{
  const rows=await staffRpc('css_staff_directory');
  const assignable=['president','vice_president'].includes(role);
  $('#content').innerHTML='<div class="panel"><h3>幹部帳號</h3><div class="tablewrap"><table><thead><tr><th>帳號</th><th>目前職務</th><th>調整職務</th></tr></thead><tbody>'+
  rows.map(r=>'<tr><td>'+esc(r.email)+'</td><td>'+esc(STAFF_NAMES[r.staff_role]||'尚未授權')+'</td><td>'+(
  assignable?'<div class="inline-actions"><select aria-label="選擇職務" data-staff-role="'+esc(r.user_id)+'">'+Object.entries(STAFF_NAMES).map(([key,name])=>'<option value="'+esc(key)+'" '+(r.staff_role===key?'selected':'')+'>'+esc(name)+'</option>').join('')+'</select><button class="secondary" data-assign="'+esc(r.user_id)+'">更新</button></div>':'只有會長／副會長可指派')+'</td></tr>').join('')+'</tbody></table></div></div>';
  document.querySelectorAll('[data-assign]').forEach(btn=>btn.onclick=async()=>{
   const id=btn.dataset.assign,chosen=document.querySelector('[data-staff-role="'+id+'"]').value;
   if(!confirm('確認將此帳號指派為「'+STAFF_NAMES[chosen]+'」？'))return;
   btn.disabled=true;
   try{toast(await staffRpc('css_assign_staff_role',{p_user_id:id,p_role:chosen}));await renderStaff()}catch(e){toast(e.message,true)}finally{btn.disabled=false}
  });
 }catch(e){$('#content').innerHTML='<div class="panel"><h3>幹部資料無法讀取</h3><p class="error">'+esc(e.message)+'</p></div>'}
}

function renderHandover(){
 $('#page-title').textContent='交接與資料備份';
 $('#content').innerHTML='<div class="panel"><h3>系學會交接中心</h3><p class="section-intro">權限更動由 Supabase 專案持有人審核。總務封存帳務、會長確認年度交接，請務必另存離線加密備份。</p><p>你的職務：<b>'+esc(STAFF_NAMES[role]||role)+'</b></p><button id="backup" class="primary">匯出可讀取的系統資料 JS