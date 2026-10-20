# PUICSA 系學會管理平台 v2

[後台](https://puicsa2025.github.io/css/) · [Supabase](https://supabase.com/dashboard/project/kcssbyfkzhtjrouwcufc) · [GitHub Actions](https://github.com/puicsa2025/css/actions)

使用 GitHub Pages、Supabase Auth／PostgreSQL／RLS 的系學會營運系統。

## 功能
- 十二種職務權限：會長、副會長、執行秘書、總務長、活動、公關、美宣、學術、體育、器材、事務、資訊
- 會員名冊、限制存取的聯絡資料、會員 CSV 批次匯入及匯出
- 系費、一般收支、選擇學期、核銷申請與非本人簽核、可列印的繳費收據
- 學期結算、封存、經特定權限更正及封存／帳務／核銷稽核
- 活動管理、公開報名頁面、可分享的報名連結與 QR Code、報名名單及簽到
- 器材資料與借還、數量檢查
- 交接中心、授權角色查詢／指派、匯出 JSON 快照
- Chrome 真實頁面載入及模擬登入進入後台的 CI 測試

## 權限矩陣
| 身分 | 財務檢視 | 財務修改 | 封存後更正／學期封存 | 管理幹部職務 |
|---|---|---|---|---|
| 會長 president | 可 | 可 | 可 | 可 |
| 副會長 vice_president | 可 | 可 | 可 | 可 |
| 執行秘書 secretary | 可 | 可 | 不可 | 不可 |
| 總務長 treasurer | 可 | 可 | 不可 | 不可 |
| 資訊部 information | 可 | 可 | 可 | 只能檢視 |
| 其餘活動、公關、美宣、學術、體育、器材、事務 | 可 | 不可 | 不可 | 不可 |

其他模組權限以 RLS 各專責部門職掌設定。會員聯絡資料僅會長、副會長、秘書、總務、資訊可讀取；報名參加者資料僅活動管理職務可讀。資料庫 role 以 **Supabase Auth app_metadata.css_role** 為準，不能從前端自行提升權限。

**舊版 css_role=admin** 僅映射成資訊部過渡身分，不會自動被認定為會長。首次須由 Supabase 專案擁有人核實實際會長帳號後，於管理控制台或受信任的 SQL Editor 指派：
```sql
update auth.users
set raw_app_meta_data = jsonb_set(
  coalesce(raw_app_meta_data,'{}'::jsonb),
  '{css_role}', '"president"', true)
where id = 'VERIFIED_PRESIDENT_USER_UUID'::uuid;
```
副會長亦同，改為 `vice_president`。初始化後會長／副會長可在「幹部職務管理」更改其他**既有** Supabase Auth 使用者的職務。新增登入帳號仍需從後端 Auth Users 建立；請關閉公開註冊、要求強密碼與 MFA。更新職務後須重新登入刷新 JWT。

## 財務流程
1. 建立年度／學期（初始提供 115 學年度第 1 學期）。
2. 新增會員，收系費時選擇會員、學年及學期；觸發器自動同步收入主帳，不能另建重複收入。
3. 一般收支必須指定所屬學期；核銷需另一名獲授權者審核。
4. 只有會長、副會長與資訊部能進行學期封存或重新開啟，需輸入原因，產生封存稽核紀錄。封存後其他幹部無法修改財務。
5. 財務異動觸發器寫入歷史紀錄；已簽核核銷不得直接覆蓋，應建立更正／新申請。

## 活動報名與 QR
在「活動管理」新增活動，狀態選「進行中（open）」且「開放報名」設為開放，按該活動的「表單 / QR」，分享公開 `register.html?event=UUID` 報名網址／QR Code。報名者填姓名、學號、Email；每場每學號至多一次，名額額滿即停止受理。參加者名單受 RLS 限制，公眾不能列出報名紀錄。

QR 圖片目前由第三方 QR 服務生成，會收到公開活動報名 URL，但不會收到表單填入的個資。對外大量開放前，**必須增加 CAPTCHA／Edge Function 限流及個資告知政策**；單純的 honeypot 與學號唯一限制不足以抵禦自動灌報名。

## 匯入、備份與交接
會員匯入 CSV 至少包含英文標題 `student_id,name`；可選 `department,class_name,year_level,status`，每次上限 300 筆。CSV 匯出適用各資料表。交接中心的 JSON 快照屬手動備份，**不等於資料庫自動備份，也尚無按鈕式還原**。請另外安排 Supabase 方案內的備份／離線加密匯出，並在測試環境定期演練還原。學年交接前確認簽核、封存、幹部撤權及資料保留／刪除規範。

## 測試與部署
- 每次 PR 都跑 Node 語法、模擬 Auth／PostgREST、真實 Chrome 啟動及非同步登入進入儀表板測試。
- PR 不能自動部署到正式 Pages；合併 main 且測試成功後才部署。
- Supabase database migrations 順序：原始 schema、舊版 audit/role policy、`20261020_association_v2.sql`、`20261020_registration_idempotency.sql`、`20261020_audit_stock.sql`、`20261020_staff_role_security_fix.sql`、`20261020_dedupe_stock_guard.sql`。
- 資料庫測試以 ROLLBACK 保證不留下假會員、假收支或假報名。
- **仍需實際三種以上登入帳號及使用者驗收**，不能把模擬 JWT／Chrome 假 API 視為正式多使用者登入完成證明。

## 安全現況
所有公開表格啟用 RLS。Supabase Advisor 對公開報名與幹部指派的 SECURITY DEFINER RPC 提出提示：這些端點是刻意開放，但已做角色與資料驗證；需持續稽核，並考慮移至非公開 schema／Edge Function。Supabase 免費方案可能未提供外洩密碼防護，請採強密碼和管理員 MFA。真正 HTTPS 安全標頭（例如 CSP、HSTS）需由網頁託管層管理，HTML 的 meta CSP 不等同服務器標頭。

> 特別注意：未完成 CAPTCHA、備份還原演練、真實帳號整合測試與正式資料處理規範前，避免立即收集大量學生個資或處理正式核銷。
