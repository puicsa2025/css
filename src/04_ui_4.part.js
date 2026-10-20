'registrations'&&!EVENT_ROLES.includes(role))&&!(k==='audit'&&!FINANCE_ROLES.includes(role)));
    const records=await Promise.all(permitted.map(async k=>[k,await fetchAll(k)]));
    const snapshot=Object.fromEntries(records);
    const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),role,data:snapshot},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='PUICSA-backup-'+new Date().toISOString().slice(0,10)+'.json';
    a.click();URL.revokeObjectURL(url);
    toast('備份已建立，請以加密方式保存');
  }catch(e){toast('備份失敗：'+e.message,true)}
  finally{button.disabled=false;button.textContent='匯出可讀取的系統資料 JSON 備份'}
 };
}

function openEditor(r){
 const k=page,markup=editForm(k,r);
 if(!markup){toast('此項目不可直接修改',true);return}
 $('#editor').innerHTML=markup;
 const panel=$('#edit-panel'),form=$('#entry-form'),cancel=$('#cancel');
 if(panel)panel.scrollIntoView({behavior:'smooth',block:'start'});
 if(cancel)cancel.onclick=()=>{$('#editor').innerHTML=''};
 if(!form)return;
 form.onsubmit=async event=>{
  event.preventDefault();
  const submit=form.querySelector('button[type="submit"]');
  if(!submit||submit.disabled)return;
  submit.disabled=true;
  try{
   const payload=Object.fromEntries(new FormData(form));
   for(const fieldDef of cfg[k].fields){
    const [name,label,type]=fieldDef;
    if(type==='number'){
     payload[name]=payload[name]===''||payload[name]===undefined?null:Number(payload[name]);
    }else if(type==='semester'){
     payload[name]=Number(payload[name]||0);
    }else if(type==='datetime-local'){
     payload[name]=payload[name]?new Date(payload[name]).toISOString():null;
    }else if(type==='yesno'){
     payload[name]=payload[name]==='true';
    }
   }
   if(k==='members'){
    payload.student_id=String(payload.student_id||'').trim();
    payload.name=String(payload.name||'').trim();
    payload.department=String(payload.department||DEFAULT_DEPARTMENT).trim()||DEFAULT_DEPARTMENT;
    if(!payload.student_id||!payload.name)throw new Error('請填寫學號與姓名');
   }
   if(k==='events'&&Number(payload.capacity)===0)payload.capacity=null;
   if(k==='reimbursements'&&!r)payload.status='pending';
   if(k==='ledger'&&r?.payment_id){toast('系費衍生帳務禁止手動修改',true);return}
   const query=r?db.from(cfg[k].table).update(payload).eq('id',r.id):db.from(cfg[k].table).insert(payload);
   const {error}=await query;
   if(error)throw error;
   try{await refresh();toast('資料已儲存')}
   catch(refreshError){toast('資料已儲存，但重新載入失敗：'+refreshError.message,true)}
  }catch(error){toast('儲存失敗：'+(error?.message||'未知錯誤'),true)}
  finally{submit.disabled=false}
 };
}
function exportCSV(k){const rows=data[k]||[],fields=cfg[k].columns;const quote=v=>{let s=String(v??'');const first=s.trimStart().charAt(0);if(first && '=+@-'.includes(first))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};const lines=[fields.map(f=>quote(f[1])).join(','),...rows.map(r=>fields.map(f=>quote(f[0]==='member_id'?mapMember(r[f[0]]):r[f[0]])).join(','))];const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PUICSA-'+k+'.csv';a.click();URL.revokeObjectURL(url)}
async function enter(session){currentUser=session?.user;if(!currentUser){$('#login').classList.remove('hidden');$('#app').classList.add('hidden');return}role=currentUser.app_metadata?.css_role||'';if(!Object.hasOwn(STAFF_NAMES,role)){$('#login-error').textContent='此帳號尚未取得管理權限，請聯絡系統管理者。';await db.auth.signOut();return}$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#user-badge').textContent=currentUser.email+' · '+STAFF_NAMES[role];const moduleAccess={contacts:MEMBER_ROLES.includes(role),audit:FINANCE_ROLES.includes(role),registrations:EVENT_ROLES.includes(role),staff:ARCHIVE_ROLES.includes(role)};
for(const [module,allow] of Object.entries(moduleAccess)){
 const nav=document.querySelector('[data-page="'+module+'"]');if(nav)nav.classList.toggle('hidden',!allow);
}try{await refresh()}catch(e){toast('載入失敗：'+e.message,true)}}
$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const button=$('#login-button'),errorBox=$('#login-error');
  errorBox.textContent='';
  button.disabled=true;button.textContent='安全驗證中…';
  try {
    const fd=new FormData(form);
    const email=String(fd.get('email')||'').trim();
    const password=String(fd.get('password')||'');
    if(!email||!password){errorBox.textContent='請輸入電子郵件與密碼。';return;}
    const response=await db.auth.signInWithPassword({email,password});
    if(response.error){errorBox.textContent='登入失敗：'+response.error.message;return;}
    form.elements.password.value='';
    await enter(response.data.session);
  } catch(err) {
    errorBox.textContent=err?.message?.includes('fetch')?'網路請求失敗，請檢查網路或服務設定。':'登入後初始化失敗：'+String(err?.message||'未知錯誤');
  } finally {
    button.disabled=false;button.textContent='安全登入 →';
  }
};
$('#nav').onclick=async e=>{
 const b=e.target.closest('[data-page]');if(!b)return;
 const destination=b.dataset.page;
 if(!NAV_PAGES.includes(destination))return;
 if(destination==='staff'&&!ARCHIVE_ROLES.includes(role))return toast('只有會長與副會長可管理幹部職務',true);
 if(destination==='contacts'&&!MEMBER_ROLES.includes(role))return toast('此帳號無權檢視會員聯絡資料',true);
 page=destination;
 document.querySelectorAll('#nav button').forEach(n=>n.classList.toggle('active',n===b));
 if(cfg[page]&&!CORE_TABLES.includes(page)){
  $('#content').innerHTML='<div class="panel"><p class="section-intro">正在載入資料…</p></div>';
  try{data[page]=await fetchAll(page)}catch(error){toast('資料載入失敗：'+error.message,true);data[page]=[]}
 }
 render();
};
$('#logout').onclick=async()=>{await db.auth.signOut();location.reload()};
$('#now').textContent=new Date().toLocaleDateString('zh-TW',{year:'numeric',month:'long',day:'numeric'});
window.PUICSA_READY=true;
$('#login-button').disabled=false;
$('#login-button').textContent='安全登入 →';
void (async () => {
try {
  const {data:{session},error}=await db.auth.getSession();
  if(session)await enter(session);
  else if(error)$('#login-error').textContent='先前登入狀態已失效，請重新登入。';
} catch {
  $('#login-error').textContent='登入服務初始化發生問題，請重新整理。';
}

})().catch(() => { const box=document.querySelector('#login-error'); if(box)box.textContent='登入狀態檢查失敗，請重新整理後再試。'; });

})();
