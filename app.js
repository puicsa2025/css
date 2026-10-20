/* PUICSA Standalone browser bootstrap, built 2026-10-20. No external CDN, no ES module imports. */
(() => {
'use strict';
// Public client configuration only. NEVER use Supabase secret or service_role API keys.
const SUPABASE_URL = 'https://kcssbyfkzhtjrouwcufc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Q86TNLgHRKvHU3VF27cKtQ_1LnvZ0AQ';

// Same-origin Supabase adapter for the PUICSA static admin console.
// Supports only the Auth and PostgREST operations used by this app.
// User credentials are transmitted solely via HTTPS POST JSON bodies.

const base = new URL(SUPABASE_URL).origin;
if (!base.startsWith('https://') || !SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
  throw new Error('Supabase 公開連線設定無效。');
}
const storageKey = 'puicsa_session_v2_' + new URL(base).host;
let session = null;
let refreshPromise = null;
try {
  session = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
} catch {
  try { sessionStorage.removeItem(storageKey); } catch { /* Blocked browser storage */ }
}
function persist(value) {
  session = value;
  try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
  else sessionStorage.removeItem(storageKey); } catch { /* Continue using in-memory session when storage is denied */ }
}
function messageFor(response, body) {
  if (response.status === 429) return '登入嘗試過於頻繁，請稍後再試。';
  if (response.status === 400 || response.status === 401) {
    const code = body?.error_code || body?.code;
    if (code === 'email_not_confirmed') return '電子郵件尚未完成驗證。';
    if (code === 'invalid_credentials') return '電子郵件或密碼不正確。';
  }
  if (response.status === 403) return '目前帳號沒有操作此資料的權限。';
  return body?.msg || body?.message || body?.error_description || '請求失敗（HTTP ' + response.status + '）。';
}
async function readResponse(response) {
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* No HTML error detail in UI */ }
  if (!response.ok) {
    const error = new Error(messageFor(response, body));
    error.status = response.status;
    throw error;
  }
  return body;
}
async function authRequest(path, body, bearer) {
  const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type':'application/json' };
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const response = await fetch(base + '/auth/v1/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  return readResponse(response);
}
function adopt(payload) {
  if (!payload?.access_token || !payload?.refresh_token || !payload?.user) {
    throw new Error('驗證伺服器未回傳完整登入資料。');
  }
  persist({
    access_token:payload.access_token,
    refresh_token:payload.refresh_token,
    expires_at:Math.floor(Date.now()/1000) + Number(payload.expires_in || 3600),
    user:payload.user
  });
  return session;
}
async function token() {
  if (!session) throw new Error('登入狀態已失效，請重新登入。');
  if (session.expires_at > Date.now()/1000 + 90) return session.access_token;
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const payload = await authRequest('token?grant_type=refresh_token', {refresh_token: session.refresh_token});
        return adopt(payload).access_token;
      } catch (error) {
        persist(null);
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}
const auth = {
  async signInWithPassword({email,password}) {
    try {
      const result = adopt(await authRequest('token?grant_type=password', {email,password}));
      return {data:{session:result,user:result.user},error:null};
    } catch(e) {
      return {data:{session:null,user:null},error:e};
    }
  },
  async getSession() {
    if (!session) return {data:{session:null},error:null};
    try {
      const bearer = await token();
      const user = await authRequest('user', undefined, bearer);
      persist({...session,user});
      return {data:{session},error:null};
    } catch(e) {
      persist(null);
      return {data:{session:null},error:e};
    }
  },
  async signOut() {
    if (session) {
      try { await authRequest('logout', {}, await token()); } catch { /* local logout still succeeds */ }
    }
    persist(null);
    return {error:null};
  }
};
async function rest(table, {method='GET', query, body, start=0, end=999}={}) {
  if (!/^css_[a-z_]+$/.test(table)) return {data:null,error:new Error('資料表名稱不合法。')};
  try {
    const access = await token();
    const url = new URL(base + '/rest/v1/' + table);
    if (query) for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    const headers = {
      apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:'Bearer '+access,
      Accept:'application/json'
    };
    if (method==='GET') {
      headers.Range = start+'-'+end;
      headers['Range-Unit'] = 'items';
    } else {
      headers['Content-Type'] = 'application/json';
      headers.Prefer = 'return=representation';
    }
    const response = await fetch(url.href,{
      method,headers,
      body:body === undefined ? undefined : JSON.stringify(body),
      cache:'no-store',
      referrerPolicy:'no-referrer'
    });
    const data = await readResponse(response);
    return {data:data || [],error:null};
  } catch(e) { return {data:null,error:e}; }
}
const db = {
  auth,
  from(table) {
    return {
      select(columns='*') {
        return {
          order(field,{ascending=false}={}) {
            if (!/^[a-z_]+$/.test(field)) throw new Error('排序欄位不合法。');
            return {
              range(start,end) {
                return rest(table,{query:{select:columns,order:field+'.'+(ascending?'asc':'desc')},start,end});
              }
            };
          }
        };
      },
      insert(payload) {
        return rest(table,{method:'POST',body:payload});
      },
      update(payload) {
        return {
          eq(field,value) {
            if (!/^[a-z_]+$/.test(field)) throw new Error('查詢欄位不合法。');
            return rest(table,{method:'PATCH',query:{[field]:'eq.'+String(value)},body:payload});
          }
        };
      }
    };
  }
};

const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>new Intl.NumberFormat('zh-TW',{style:'currency',currency:'TWD',maximumFractionDigits:0}).format(Number(n)||0);

const STAFF_NAMES={president:'會長',vice_president:'副會長',secretary:'執行秘書',treasurer:'總務長／財務',activities:'活動部',public_relations:'公關部',design:'美宣部',academic:'學術部',sports:'體育部',equipment:'器材長',affairs:'事務部',information:'資訊部'};
const FINANCE_ROLES=['president','vice_president','secretary','treasurer','information'];
const ARCHIVE_ROLES=['president','vice_president','information'];
const EVENT_ROLES=['president','vice_president','secretary','activities','information'];
const ASSET_ROLES=['president','vice_president','equipment','affairs','information'];
const MEMBER_ROLES=['president','vice_president','secretary','treasurer','information'];
const ANNOUNCE_ROLES=['president','vice_president','secretary','public_relations','information'];
const NAV_PAGES=['overview','members','payments','ledger','reimbursements','periods','events','registrations','assets','loans','announcements','audit','period_audit','handover'];
const cfg={
 members:{table:'css_members',title:'會員名冊',description:'統一管理學生資料與會員狀態',columns:[['student_id','學號'],['name','姓名'],['class_name','班級'],['year_level','年級'],['status','狀態']],fields:[['student_id','學號','text',true],['name','姓名','text',true],['department','系所'],['class_name','班級'],['year_level','年級','number']]},
 payments:{table:'css_payments',title:'系費管理',description:'繳費資料會自動同步收入主帳',columns:[['member_id','會員'],['academic_year','學年度'],['semester','學期'],['amount','實收金額'],['paid_at','繳費日期']],fields:[['member_id','會員','member',true],['academic_year','學年度','text',true],['semester','學期','semester',true],['amount','金額','number',true],['paid_at','繳費日期','date',true],['payment_method','繳費方式','method'],['note','備註']]},
 ledger:{table:'css_ledger',title:'收支帳務',description:'追蹤收入、支出與核銷狀態；系費由繳費紀錄自動產生',columns:[['occurred_on','日期'],['direction','類型'],['category','分類'],['description','摘要'],['amount','金額'],['reimbursement_status','核銷']],fields:[['occurred_on','日期','date',true],['direction','收支類型','direction',true],['category','分類','text',true],['description','摘要','text',true],['amount','金額','number',true],['reimbursement_status','核銷狀態','reimbursement'],['receipt_url','憑證連結','url'],['period_id','學期','period',true]]},
 events:{table:'css_events',title:'活動管理',description:'活動規劃、預算、日期與執行進度',columns:[['title','活動名稱'],['starts_at','開始日期'],['location','地點'],['budget','預算'],['status','進度'],['registration_enabled','報名']],fields:[['title','活動名稱','text',true],['starts_at','開始時間','datetime-local',true],['ends_at','結束時間','datetime-local'],['location','活動地點'],['budget','預算','number'],['status','執行狀態','eventstatus'],['description','活動說明'],['capacity','報名人數上限','number'],['registration_enabled','開放報名','yesno'],['registration_deadline','報名截止時間','datetime-local']]},
 assets:{table:'css_assets',title:'器材管理',description:'器材數量、保管位置與使用狀態',columns:[['code','器材編號'],['name','品名'],['quantity','數量'],['location','保管地點'],['condition','狀態']],fields:[['code','器材編號'],['name','器材名稱','text',true],['quantity','數量','number',true],['location','保管位置'],['condition','使用狀態'],['note','備註']]},
 announcements:{table:'css_announcements',title:'公告管理',description:'內部重要訊息與工作通知',columns:[['title','公告主旨'],['content','內容'],['published_at','發布日期']],fields:[['title','公告主旨','text',true],['content','公告內容','textarea',true]]},
 reimbursements:{table:'css_reimbursements',title:'核銷簽核',description:'提交、批准、退件；申請人不能自行審核',columns:[['ledger_id','帳務'],['status','進度'],['requested_at','申請日期'],['review_note','簽核註記']],fields:[['ledger_id','支出帳務','expense',true],['status','核銷狀態','approval'],['review_note','簽核說明'],['attachment_url','佐證連結','url']]},
 periods:{table:'css_periods',title:'學期結算封存',description:'只有會長、副會長與資訊部可封存／重新開啟；異動皆留痕',columns:[['academic_year','學年度'],['semester','學期'],['status','狀態'],['closed_at','封存時間'],['close_note','異動原因']],fields:[['academic_year','學年度','text',true],['semester','學期','semester',true]]},
 period_audit:{table:'css_period_audit',title:'學期封存稽核',description:'封存與重新開啟的不可直接修改紀錄',columns:[['changed_at','異動日期'],['old_status','原狀態'],['new_status','新狀態'],['note','原因'],['changed_by','操作人員']],fields:[]},
 registrations:{table:'css_event_registrations',title:'活動報名名單',description:'參加者資料只開放活動負責角色存取，支持簽到',columns:[['event_id','活動'],['participant_name','姓名'],['student_id','學號'],['checked_in_at','簽到'],['created_at','報名時間']],fields:[]},
 loans:{table:'css_asset_loans',title:'器材借還',description:'登記領用、應還日期及實際歸還紀錄',columns:[['asset_id','器材'],['borrower','借用人'],['quantity','借用數'],['due_at','應還時間'],['returned_at','歸還時間']],fields:[['asset_id','器材','asset',true],['borrower','借用人','text',true],['quantity','借用數量','number',true],['due_at','預計歸還','datetime-local'],['returned_at','實際歸還','datetime-local'],['notes','備註']]},
 audit:{table:'css_finance_audit',title:'財務稽核',description:'所有系費與收支異動的唯讀紀錄（僅供管理員及財務）',columns:[['changed_at','時間'],['source_table','資料表'],['operation','操作'],['record_id','資料編號'],['actor_uid','操作帳號']],fields:[]}
};
const tables=['members','payments','ledger','reimbursements','periods','period_audit','events','registrations','assets','loans','announcements','audit'];let page='overview', data={}, currentUser=null,role='';
function toast(msg,bad=false){const el=$('#toast');el.textContent=msg;el.className=bad?'bad':'';el.style.display='block';setTimeout(()=>el.style.display='none',5500)}
function canWrite(p){if(['audit','period_audit','registrations'].includes(p))return false;return (p==='ledger'||p==='payments'||p==='reimbursements')?FINANCE_ROLES.includes(role):p==='periods'?ARCHIVE_ROLES.includes(role):p==='events'?EVENT_ROLES.includes(role):p==='assets'||p==='loans'?ASSET_ROLES.includes(role):p==='members'?MEMBER_ROLES.includes(role):p==='announcements'?ANNOUNCE_ROLES.includes(role):false}
async function fetchAll(k){const rows=[];let from=0;for(;;){const {data:page,error}=await db.from(cfg[k].table).select(k==='members'?'id,student_id,name,department,class_name,year_level,status,joined_at,created_at':'*').order(['audit','period_audit'].includes(k)?'changed_at':'created_at',{ascending:false}).range(from,from+999);if(error)throw error;rows.push(...(page||[]));if(!page||page.length<1000)break;from+=1000;}return rows}
async function refresh(){const entries=await Promise.all(tables.map(async k=>[k,await fetchAll(k)]));for(const [k,rows] of entries)data[k]=rows;render()}
function mapMember(v){const m=(data.members||[]).find(x=>x.id===v);return m?m.name+' ('+m.student_id+')':'—'}
function cell(k,v){if(k==='member_id')return esc(mapMember(v));if(k==='ledger_id')return esc((data.ledger||[]).find(x=>x.id===v)?.description||'—');if(k==='asset_id')return esc((data.assets||[]).find(x=>x.id===v)?.name||'—');if(k==='event_id')return esc((data.events||[]).find(x=>x.id===v)?.title||'—');if(k==='registration_enabled')return v?'開放':'未開放';if(k==='semester')return v===1?'上學期':'下學期';if(k==='amount'||k==='budget')return fmt(v);if(k==='direction')return v==='income'?'<span class="pill green">收入</span>':'<span class="pill orange">支出</span>';if(k==='status'||k==='reimbursement_status')return '<span class="pill">'+esc(v)+'</span>';if(['starts_at','published_at','changed_at','due_at','returned_at','checked_in_at','closed_at','requested_at','created_at'].includes(k))return esc(v?new Date(v).toLocaleString('zh-TW'):'—');return esc(v||'—')}
function rowButtons(k,r){
 let parts=[];
 if(canWrite(k)&&!['payments','periods'].includes(k)&&!(k==='ledger'&&r.payment_id)&&!(k==='reimbursements'&&r.status!=='pending'))parts.push('<button class="secondary" data-edit="'+esc(r.id)+'">編輯</button>');
 if(k==='periods'&&ARCHIVE_ROLES.includes(role))parts.push('<button class="secondary" data-toggle-period="'+esc(r.id)+'">'+(r.status==='open'?'封存學期':'重新開啟')+'</button>');
 if(k==='events'&&r.registration_enabled)parts.push('<button class="secondary" data-qr="'+esc(r.id)+'">表單 / QR</button>');
 if(k==='registrations'&&EVENT_ROLES.includes(role)&&!r.checked_in_at)parts.push('<button class="secondary" data-checkin="'+esc(r.id)+'">簽到</button>');
 if(k==='loans'&&ASSET_ROLES.includes(role)&&!r.returned_at)parts.push('<button class="secondary" data-return="'+esc(r.id)+'">歸還</button>');
 if(k==='payments')parts.push('<button class="secondary" data-receipt="'+esc(r.id)+'">收據</button>');
 return parts.join(' ')||'—';
}
function tableView(k,items){const c=cfg[k];return '<div class="tablewrap"><table><thead><tr>'+c.columns.map(x=>'<th>'+x[1]+'</th>').join('')+'<th>操作</th></tr></thead><tbody>'+(items.length?items.map(r=>'<tr>'+c.columns.map(x=>'<td>'+cell(x[0],r[x[0]])+'</td>').join('')+'<td>'+rowButtons(k,r)+'</td></tr>').join(''):'<tr><td colspan="'+(c.columns.length+1)+'" class="empty">目前沒有資料</td></tr>')+'</tbody></table></div>'}
function dashboard(){const d=data, members=d.members||[],payments=d.payments||[],ledger=d.ledger||[],events=d.events||[];const income=ledger.filter(x=>x.direction==='income').reduce((a,x)=>a+Number(x.amount),0),expense=ledger.filter(x=>x.direction==='expense').reduce((a,x)=>a+Number(x.amount),0),pending=ledger.filter(x=>x.reimbursement_status==='pending').length;const rows=ledger.slice().sort((a,b)=>String(b.occurred_on).localeCompare(String(a.occurred_on))).slice(0,6);const categories=Object.entries(ledger.reduce((a,x)=>(a[x.category]=(a[x.category]||0)+Number(x.amount),a),{})).sort((a,b)=>b[1]-a[1]).slice(0,5);return '<div class="heading-row"><h3>營運概況</h3><button class="secondary" id="reload">↻ 重新整理</button></div><div class="grid"><div class="metric"><div class="cap">總收入</div><strong>'+fmt(income)+'</strong><small>已入帳</small></div><div class="metric"><div class="cap">總支出</div><strong>'+fmt(expense)+'</strong><small>已登錄</small></div><div class="metric"><div class="cap">帳面餘額</div><strong>'+fmt(income-expense)+'</strong><small>收入扣除支出</small></div><div class="metric"><div class="cap">有效會員</div><strong>'+members.filter(x=>x.status==='active').length+'</strong><small>全體 '+members.length+' 名會員</small></div></div><div class="grid" style="margin-top:17px"><div class="metric"><div class="cap">活動數量</div><strong>'+events.length+'</strong><small>管理中的活動</small></div><div class="metric"><div class="cap">待核銷筆數</div><strong>'+pending+'</strong><small>請總務人員確認</small></div><div class="metric"><div class="cap">系費筆數</div><strong>'+payments.length+'</strong><small>歷史收款紀錄</small></div><div class="metric"><div class="cap">器材種類</div><strong>'+(d.assets||[]).length+'</strong><small>已登錄器材</small></div></div><div class="panels"><section class="panel"><h3>最新收支紀錄</h3>'+tableView('ledger',rows)+'</section><section class="panel"><h3>收支類別分析</h3>'+(categories.length?categories.map(([name,n])=>'<div class="bar-item"><div class="bar-label"><span>'+esc(name)+'</span><b>'+fmt(n)+'</b></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(n/categories[0][1]*100)+'%"></div></div></div>').join(''):'<div class="empty">新增收支後會顯示分析</div>')+'</section></div>'}
function choices(type){return {semester:[['1','上學期'],['2','下學期']],direction:[['income','收入'],['expense','支出']],approval:[['pending','待審核'],['approved','核准'],['rejected','退件']],yesno:[['false','關閉'],['true','開放']],reimbursement:[['none','無需核銷'],['pending','待核銷'],['approved','已核銷'],['rejected','退件']],eventstatus:[['planning','規劃中'],['open','進行中'],['completed','已完成'],['cancelled','已取消']],method:[['cash','現金'],['transfer','匯款'],['other','其他']]}[type]}
function field([name,label,type='text',required],val){let value=val??(type==='date'?new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10):type==='number'?'0':'');if(['period','asset','expense'].includes(type)){const rows=type==='period'?(data.periods||[]):type==='asset'?(data.assets||[]):(data.ledger||[]).filter(l=>l.direction==='expense');return '<label>'+label+'<select name="'+name+'" required><option value="">請選擇</option>'+rows.map(row=>{const text=type==='period'?(row.academic_year+'-'+row.semester+(row.status==='closed'?'【封存】':'')):type==='asset'?row.name:(row.description+' ('+fmt(row.amount)+')');return '<option value="'+esc(row.id)+'" '+(value===row.id?'selected':'')+'>'+esc(text)+'</option>'}).join('')+'</select></label>'}if(type==='member'){return '<label>'+label+'<select name="'+name+'" required><option value="">選擇會員</option>'+(data.members||[]).map(m=>'<option value="'+esc(m.id)+'" '+(value===m.id?'selected':'')+'>'+esc(m.student_id+' '+m.name)+'</option>').join('')+'</select></label>'}if(choices(type))return '<label>'+label+'<select name="'+name+'">'+choices(type).map(([v,l])=>'<option value="'+v+'" '+(String(value)===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';if(type==='datetime-local'&&value){const d=new Date(value);if(!Number.isNaN(d.getTime())){const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);value=local.toISOString().slice(0,16);}else value=String(value).slice(0,16)}if(type==='number'&&name==='year_level'&&val==null)value='';if(type==='textarea')return '<label class="field-span">'+label+'<textarea name="'+name+'" rows="3">'+esc(value)+'</textarea></label>';return '<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+(type==='number'?' min="0" step="any"':'')+'></label>'}
function editForm(k,r){const c=cfg[k];const editable=(k==='ledger'&&r?.payment_id)|| (k==='reimbursements'&&r?.status!=='pending')?false:canWrite(k);if(!editable)return '';return '<section class="panel" id="edit-panel"><h3>'+(r?'編輯':'新增')+c.title+'</h3><form id="entry-form"><div class="form-grid">'+c.fields.map(x=>field(x,r?.[x[0]])).join('')+'</div><div class="form-actions"><button class="secondary" type="button" id="cancel">取消</button><button class="primary" type="submit">儲存資料</button></div></form></section>'}
function render(){
 const el=$('#content');
 if(page==='handover'){renderHandover();return}
 $('#page-title').textContent=page==='overview'?'營運總覽':cfg[page].title;
 if(page==='overview'){
  el.innerHTML=dashboard();
  $('#reload').onclick=async()=>{try{await refresh();toast('資料已更新')}catch(e){toast(e.message,true)}};
  return;
 }
 const c=cfg[page],r=data[page]||[];
 const special=page==='members'&&MEMBER_ROLES.includes(role)?'<label class="secondary small-upload">批次匯入 CSV<input id="csv-members" type="file" accept=".csv,text/csv" hidden></label>':'';
 el.innerHTML='<p class="section-intro">'+c.description+'</p><div class="panel"><div class="toolbar"><input id="search" placeholder="搜尋資料..."><div class="inline-actions">'+special+'<button class="secondary" id="export">匯出 CSV</button>'+(canWrite(page)&&page!=='period_audit'?'<button class="primary" id="add">＋ 新增資料</button>':'')+'</div></div><div id="records">'+tableView(page,r)+'</div></div><div id="editor"></div>';
 $('#search').oninput=e=>{const q=e.target.value.toLowerCase();$('#records').innerHTML=tableView(page,r.filter(x=>JSON.stringify(x).toLowerCase().includes(q)));bindEdits()};
 $('#export').onclick=()=>exportCSV(page);
 if($('#add'))$('#add').onclick=()=>openEditor(null);
 if($('#csv-members'))$('#csv-members').onchange=importMembers;
 bindEdits();
}
function bindEdits(){
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor((data[page]||[]).find(r=>r.id===b.dataset.edit)));
 document.querySelectorAll('[data-toggle-period]').forEach(b=>b.onclick=()=>closePeriod(b.dataset.togglePeriod));
 document.querySelectorAll('[data-qr]').forEach(b=>b.onclick=()=>showEventQr(b.dataset.qr));
 document.querySelectorAll('[data-checkin]').forEach(b=>b.onclick=()=>setDate('registrations',b.dataset.checkin,'checked_in_at'));
 document.querySelectorAll('[data-return]').forEach(b=>b.onclick=()=>setDate('loans',b.dataset.return,'returned_at'));
 document.querySelectorAll('[data-receipt]').forEach(b=>b.onclick=()=>printReceipt(b.dataset.receipt));
}
async function closePeriod(id){
 if(!ARCHIVE_ROLES.includes(role))return toast('無此操作權限',true);
 const current=(data.periods||[]).find(x=>x.id===id);
 if(!current)return;
 const next=current.status==='open'?'closed':'open';
 const verb=next==='closed'?'執行封存':'重新開啟';
 const reason=prompt('確認'+verb+'「'+current.academic_year+'學年度第'+current.semester+'學期」？請填寫原因（至少4字）：');
 if(reason===null)return;
 if(reason.trim().length<4)return toast('請填寫至少4字的原因',true);
 if(!confirm('確定'+verb+'？此操作會保留稽核紀錄。'))return;
 const {error}=await db.from('css_periods').update({status:next,close_note:reason.trim()}).eq('id',id);
 if(error)return toast(error.message,true);
 await refresh();toast('學期已'+(next==='closed'?'封存':'重新開啟'));
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
 const win=window.open('','_blank','noopener,noreferrer');
 if(!win)return toast('瀏覽器封鎖了收據視窗，請允許快顯視窗',true);
 win.document.write(html);win.document.close();
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
function renderHandover(){
 $('#page-title').textContent='交接與資料備份';
 $('#content').innerHTML='<div class="panel"><h3>系學會交接中心</h3><p class="section-intro">權限更動由 Supabase 專案持有人審核。總務封存帳務、會長確認年度交接，請務必另存離線加密備份。</p><p>你的職務：<b>'+esc(STAFF_NAMES[role]||role)+'</b></p><button id="backup" class="primary">匯出可讀取的系統資料 JSON 備份</button><p class="note">不包含受限制的會員聯絡資料。務必存放於受控位置；還原流程需由資訊部於測試環境演練。</p></div><div class="panel"><h3>角色職責</h3><div class="role-grid">'+Object.entries(STAFF_NAMES).map(([r,n])=>'<div><b>'+esc(n)+'</b><small>'+esc(r)+'</small></div>').join('')+'</div></div>';
 $('#backup').disabled=!ARCHIVE_ROLES.includes(role);
 $('#backup').onclick=()=>{
  const blob=new Blob([JSON.stringify({exported_at:new Date().toISOString(),role,data},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PUICSA-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);
 };
}

function openEditor(r){const k=page;$('#editor').innerHTML=editForm(k,r);$('#editor').scrollIntoView({behavior:'smooth',block:'start'});$('#cancel').onclick=()=>$('#editor').innerHTML='';$('#entry-form').onsubmit=async e=>{e.preventDefault();const submit=$('#entry-form button[type=submit]');submit.disabled=true;const payload=Object.fromEntries(new FormData(e.target));for(const f of cfg[k].fields)if(f[2]==='number'||f[2]==='semester')payload[f[0]]=Number(payload[f[0]]||0);for(const f of cfg[k].fields)if(f[2]==='datetime-local')payload[f[0]]=payload[f[0]]?new Date(payload[f[0]]).toISOString():null;if(f[2]==='yesno')payload[f[0]]=payload[f[0]]==='true';for(const key of ['year_level'])if(k==='members'&&!payload[key])payload[key]=null;if(k==='reimbursements'&&!r)payload.status='pending';if(k==='ledger'&&r?.payment_id){toast('系費衍生帳務禁止手動修改',true);submit.disabled=false;return}const query=r?db.from(cfg[k].table).update(payload).eq('id',r.id):db.from(cfg[k].table).insert(payload);const {error}=await query;submit.disabled=false;if(error){toast('儲存失敗：'+error.message,true);return}try{await refresh();toast('資料已儲存')}catch(e){toast(e.message,true)}}}
function exportCSV(k){const rows=data[k]||[],fields=cfg[k].columns;const quote=v=>{let s=String(v??'');const first=s.trimStart().charAt(0);if(first && '=+@-'.includes(first))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};const lines=[fields.map(f=>quote(f[1])).join(','),...rows.map(r=>fields.map(f=>quote(f[0]==='member_id'?mapMember(r[f[0]]):r[f[0]])).join(','))];const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='PUICSA-'+k+'.csv';a.click();URL.revokeObjectURL(url)}
async function enter(session){currentUser=session?.user;if(!currentUser){$('#login').classList.remove('hidden');$('#app').classList.add('hidden');return}role=currentUser.app_metadata?.css_role||'';if(role==='admin')role='information';if(!Object.hasOwn(STAFF_NAMES,role)){$('#login-error').textContent='此帳號尚未取得管理權限，請聯絡系統管理者。';await db.auth.signOut();return}$('#login').classList.add('hidden');$('#app').classList.remove('hidden');$('#user-badge').textContent=currentUser.email+' · '+STAFF_NAMES[role];const auditNav=document.querySelector('[data-page="audit"]');if(auditNav)auditNav.classList.toggle('hidden',role==='officer');try{await refresh()}catch(e){toast('載入失敗：'+e.message,true)}}
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
$('#nav').onclick=e=>{const b=e.target.closest('[data-page]');if(!b)return;page=b.dataset.page;document.querySelectorAll('#nav button').forEach(n=>n.classList.toggle('active',n===b));render()};
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
