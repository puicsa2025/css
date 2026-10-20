# PUICSA 系學會管理平台
以 GitHub Pages + Supabase 建置的獨立系學會後台，繁體中文 RWD 介面。
## 功能
- 儀表板：收入、支出、餘額、會員數、活動數、待核銷
- 會員：新增與編輯、學號唯一性
- 系費：登錄與自動收入入帳（資料庫觸發器）
- 收支：類別、核銷、憑證連結與 CSV 匯出
- 活動、器材、公告維護
- Supabase Auth；僅管理員核發帳號，**無公開註冊**
## 部署步驟
1. 在指定 Supabase 組織建立專案，執行 `supabase/schema.sql`。
2. Supabase Dashboard > Authentication > Providers 中關閉公開使用者註冊（Disable signup）。
3. Supabase Dashboard > Authentication > Users 由管理者新增幹部帳號。
4. 對使用者設定 **app_metadata** 的 `css_role`，值為 `admin`、`treasurer` 或 `officer`。只能由有權限的管理端/API 操作，不能放在 user_metadata。可由管理員在 SQL Editor 僅針對已核實的帳號執行：
```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"css_role":"admin"}'::jsonb
where email = 'CHANGE_TO_AUTHORIZED_ADMIN_EMAIL';
```
5. 到 Supabase Dashboard > Settings/API Keys 取得 **Publishable key** 與 Project URL，更新 `config.js` 的兩個公開欄位。**絕對不可使用 secret/service_role key。**
6. GitHub Repository > Settings > Pages 設定 Deploy from branch: main/root，並在 Supabase Auth URL 設定允許 Pages 網址。
7. 建議正式使用前驗證權限、交易自動入帳、不同瀏覽器登入、手機版、匯出 CSV、財務資料備份。
## 財務資料與安全
- 權限實施於 PostgreSQL RLS（不是只隱藏按鈕）。
- 系費每會員每學期一筆；自動建立帳務收入，避免重複。
- 系費衍生帳務不得由一般客戶端手動編輯。
- 目前帳務沒有不可竄改稽核簿、正式雙人核銷簽核與附件上傳，正式記帳前需完成這些治理流程。
- 本版為首版可測試系統，尚未經獨立安全滲透測試。
