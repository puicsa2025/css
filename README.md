# PUICSA 系學會管理平台

靜宜大學系學會營運管理系統。繁體中文 RWD 單頁後台，前端採純 HTML/CSS/JavaScript，後端採 Supabase Auth + PostgreSQL RLS。

## 專案連結
- [GitHub 原始碼](https://github.com/puicsa2025/css)
- [Supabase 專案](https://supabase.com/dashboard/project/kcssbyfkzhtjrouwcufc)
- 預計 GitHub Pages 網址：`https://puicsa2025.github.io/css/`（**僅在 Pages 啟用且部署成功後才可使用**）

## 已完成的模組
- 營運儀表板：收入、支出、帳面餘額、會員、活動、待核銷
- 會員名冊：學號、系級、聯絡資料、會員狀態
- 系費：會員／學年／學期的唯一收款紀錄，資料庫觸發器自動入收入主帳
- 收支：分類、核銷狀態、憑證連結、CSV 匯出
- 活動與預算、器材資產、公告
- 財務稽核：新增、修改、刪除事件的唯讀歷史資料
- 三種存取角色：admin / treasurer / officer；沒有公開註冊畫面

## 現有 Supabase 連線
- Project reference: `kcssbyfkzhtjrouwcufc`
- Region: Tokyo `ap-northeast-1`
- 前端 `config.js` 僅使用可公開的 publishable key。**禁止把 service_role 或 secret key 放在前端／GitHub 公開程式庫。**
- 首次資料庫 migration `puicsa_initial_schema` 已套用，後續 `puicsa_rls_optimization_financial_audit` 與 `puicsa_split_write_policies` 已套用。

## 上線前管理者必做（尚未由連接器完成）
1. Supabase Dashboard > Authentication > Providers/Sign In（介面可能隨版本微調），**停用 Email 公開註冊 / Allow new users to sign up**。前端沒註冊按鈕不等於已停用後端註冊。
2. Supabase Dashboard > Authentication > Users，由管理員建立幹部帳號、發送安全登入方式。不使用預設公開管理員或硬編碼密碼。
3. 在後端管理介面（或受信任的管理 SQL 操作）設定目標帳號的 **app_metadata.css_role** 為 `admin`、`treasurer`、`officer`。角色決策不得使用可由使用者修改的 `user_metadata`。
   僅在**核對帳號確屬授權管理員**後，才於 SQL Editor 執行（更換電子郵件）：
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"css_role":"admin"}'::jsonb
   where email = 'VERIFIED_ADMIN_EMAIL';
   ```
   更改角色後請重新登入，以更新使用者 JWT。
4. GitHub Repo [Settings > Pages](https://github.com/puicsa2025/css/settings/pages)：Build and deployment > Source 設為 **GitHub Actions**。本 repo 已備妥 `.github/workflows/pages.yml`，合併到 main 後會觸發網站部署。
5. 完成後檢查 [GitHub Actions](https://github.com/puicsa2025/css/actions)，確認 Pages deploy 為成功，然後開啟 `https://puicsa2025.github.io/css/` 驗證 UI。
6. 登入真實管理員與財務幹部帳號，測試新增會員、系費入帳、修改金額、財務稽核及無權限帳號存取（不應能讀寫）。
7. 制定經費核銷、附件保存、資料備份、帳號離職撤權及個資告知／存取規範。

## 本次測試紀錄
- 資料庫 schema/migrations 已套用。
- 測試資料在 transaction 中產生並於 ROLLBACK 後還原，不留下假帳。
- 以資料庫交易模擬財務角色，驗證收款新增、修改後，同一筆收入同步更新、不重複入帳。
- 稽核測試預期產生四筆異動事件並通過檢查。
- Security Advisor 沒有列出問題；Performance Advisor 僅有新索引「尚未使用」資訊提示。
- GitHub Actions 的 JS 靜態驗證與 Pages 部署另以 [Actions 執行結果](https://github.com/puicsa2025/css/actions) 為準。
- **尚未進行真實登入的端到端瀏覽器測試、獨立滲透測試或正式財務稽核驗收。**

## 財務與資料安全備註
- RLS 是伺服器端存取保護，不依賴前端隱藏按鈕。
- 財務稽核表不開放瀏覽器直接新增、更改或刪除。
- 目前採單階段的核銷狀態更新，未實作雙人簽核、發票／收據實體上傳或自動備份恢復；正式會計／核銷流程需要另行驗收。
- 免費方案仍應監測使用額度、備份與超額政策。
