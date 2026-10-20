ction class="panel"><h3>最新收支紀錄</h3>'+tableView('ledger',rows)+'</section><section class="panel"><h3>收支類別分析</h3>'+(categories.length?categories.map(([name,n])=>'<div class="bar-item"><div class="bar-label"><span>'+esc(name)+'</span><b>'+fmt(n)+'</b></div><div class="bar-track"><div class="bar-fill" style="width:'+Math.round(n/categories[0][1]*100)+'%"></div></div></div>').join(''):'<div class="empty">新增收支後會顯示分析</div>')+'</section></div>'}
function choices(type){return {semester:[['1','上學期'],['2','下學期']],direction:[['income','收入'],['expense','支出']],approval:[['pending','待審核'],['approved','核准'],['rejected','退件']],yesno:[['false','關閉'],['true','開放']],reimbursement:[['none','無需核銷'],['pending','待核銷'],['approved','已核銷'],['rejected','退件']],eventstatus:[['planning','規劃中'],['open','進行中'],['completed','已完成'],['cancelled','已取消']],method:[['cash','現金'],['transfer','匯款'],['other','其他']]}[type]}
function field([name,label,type='text',required],val){let value=val??(type==='date'?new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10):type==='number'?'0':'');if(['period','asset','expense'].includes(type)){const rows=type==='period'?(data.periods||[]):type==='asset'?(data.assets||[]):(data.ledger||[]).filter(l=>l.direction==='expense');return '<label>'+label+'<select name="'+name+'" required><option value="">請選擇</option>'+rows.map(row=>{const text=type==='period'?(row.academic_year+'-'+row.semester+(row.status==='closed'?'【封存】':'')):type==='asset'?row.name:(row.description+' ('+fmt(row.amount)+')');return '<option value="'+esc(row.id)+'" '+(value===row.id?'selected':'')+'>'+esc(text)+'</option>'}).join('')+'</select></label>'}if(type==='member'){return '<label>'+label+'<select name="'+name+'" required><option value="">選擇會員</option>'+(data.members||[]).map(m=>'<option value="'+esc(m.id)+'" '+(value===m.id?'selected':'')+'>'+esc(m.student_id+' '+m.name)+'</option>').join('')+'</select></label>'}if(choices(type))return '<label>'+label+'<select name="'+name+'">'+choices(type).map(([v,l])=>'<option value="'+v+'" '+(String(value)===v?'selected':'')+'>'+l+'</option>').join('')+'</select></label>';if(type==='datetime-local'&&value){const d=new Date(value);if(!Number.isNaN(d.getTime())){const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);value=local.toISOString().slice(0,16);}else value=String(value).slice(0,16)}if(type==='number'&&name==='year_level'&&val==null)value='';if(type==='textarea')return '<label class="field-span">'+label+'<textarea name="'+name+'" rows="3">'+esc(value)+'</textarea></label>';return '<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(required?'required':'')+(type==='number'?' min="0" step="any"':'')+'></label>'}
function editForm(k,r){const c=cfg[k];const editable=(k==='ledger'&&r?.payment_id)|| (k==='reimbursements'&&r&&r.status!=='pending')?false:canWrite(k);if(!editable)return '';return '<section class="panel" id="edit-panel"><h3>'+(r?'編輯':'新增')+c.title+'</h3><form id="entry-form"><div class="form-grid">'+c.fields.map(x=>field(x,r?.[x[0]])).join('')+'</div><div class="form-actions"><button class="secondary" type="button" id="cancel">取消</button><button class="primary" type="submit">儲存資料</button></div></form></section>'}
function render(){
 const el=$('#content');
 if(page==='handover'){renderHandover();return}
 if(page==='staff'){renderStaff();return}
 $('#page-title').textContent=page==='overview'?'營運總覽':cfg[page].title;
 if(page==='overview'){
  el.innerHTML=dashboard();
  $('#reload').onclick=async()=>{try{await refresh();toast('資料已更新')}catch(e){toast(e.message,true)}};$('#period-filter').onchange=e=>{selectedPeriod=e.target.value;render()};
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
 await refresh()