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

