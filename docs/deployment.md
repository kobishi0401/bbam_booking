# BBAM 預約修正與部署

修改基準：Amy 於 2026-10-09 提供的 Apps Script base；GitHub main 的前端。

## 確認的規則

- 週一至週六同樣開放預約，週日公休。取消週六月份切換與免預約功能。
- 當月及後兩個月份、14:00～19:30、半小時一個時段。
- 保留 Sheet 的 buffer_hours=3；所有日期以台北時間判斷。
- 一個時段只能成立一組，人數不影響容量；人數選單保留 1～4 人／5 人以上。
- 已成立時段灰色停用、標示「已預約」，不顯示紅色額滿區塊。
- 特殊公休仍適用；待付款不占位，取消釋放。
- Email 必填，保留 $200 保證金、人工爽約／逾時標記、原通知及提醒。

## 已查到的線上版本差異

- booking.bbam.com.tw 目前前端指向 AKfycbww… 舊部署。該部署 getSettings/getHolidays 成功，但 getAvailability 回覆未知 action。
- 雲端改動紀錄的 AKfycbxf… 新部署能讀設定（3 小時、Turnstile 啟用），但 getHolidays/getAvailability 回 SERVICE_UNAVAILABLE。
- GitHub 原前端沒有 requestId/botToken，且傳送「1 人」等字串；提供的 base 要求 requestId、數字人數及 Turnstile。隔離測試已重現拒絕提交。
- GitHub 的 backend/code.js 原本是空檔。這次加入完整 base 加修正，並非線上部署的備份。
- Sheet A:H 是預約欄位，I:M 是營運欄位，N:S 是系統欄位；setup 保留既有營運欄位。

## 部署順序

1. 在使用者指定的 Apps Script 專案，把原程式另存備份，再完整替換為 backend/code.js。
2. 保留既有指令碼屬性。確認 SHEET_ID 指向指定試算表；TURNSTILE_SECRET/LINE_TOKEN 等密鑰只放屬性。
3. 執行 setupBookingSystem（可重跑），確認 BOOKING_META_COLUMN 對應 N 欄，提交紀錄表已存在。
4. 執行 getHolidays，若失敗，在執行記錄查看問題列號；不要忽略錯誤。
5. 更新 AKfycbxf… 那一個既有 Web App 部署為新版本，保留公開存取及執行帳號。勿只存檔未更新部署。
6. GET 驗收 getSettings/getHolidays/getAvailability：設定為 3 小時、bot_required=true、週六正常可讀、週日不可預約。
7. 確認 getAvailability 成功後，才合併前端 PR。index.html 已指向 AKfycbxf… 部署；若實際部署網址不同，合併前必須改成已驗證的網址。
8. 驗證真實 Turnstile、寄信、LINE、日曆及取消 edit trigger。測試正式提交會寫入資料及通知，需事先安排明確測試資料與收件對象。

本次不需更改試算表設定。sat_bookable_months 舊列不再被程式使用，保留作為歷史資料。

## 保證金確認方式

線上收到 deposit_required 只在提交紀錄保存請求結果並通知客服，不建立正式預約、不占位。客人聯繫 LINE 後，客服可把必要資料填入預約表 A:H，H 設為「待付款」，人數沿用選單標示。

核對款項後，使用安全確認函式；不要直接將 H 改為「確認」，那樣會繞過容量檢查。

容器綁定指令碼：在指定試算表選一筆待付款列，執行 confirmDepositBookingFromSelectedRow。

獨立指令碼：新增下列管理者執行函式，把 42 改為真實待付款列號，再執行 confirmPaidBooking。管理函式沒有公開 API。

```js
function confirmPaidBooking() {
  return confirmDepositBooking(42);
}
```

確認時會加鎖並重新檢查日期、公休、提前限制、時段容量與同手機三筆限制。時段被訂走時拋出錯誤，該筆維持待付款，客服與客人安排其他時段。確認成功才成立並建立日曆、寄確認信、通知 LINE。

取消仍以 H 欄「取消」為準。需保留可授權的 onSheetEdit 安裝型編輯觸發器、sendDailyReminders 每日觸發器，以及 cleanupSubmissionLog 清理觸發器；本次未驗證線上觸發器設定。

## 驗證

```sh
node tests/backend.cjs
node tests/frontend.cjs
```

瀏覽器測試需安裝 Playwright 與 Chromium；或設定 PLAYWRIGHT_CHANNEL=msedge 使用已安裝的 Edge。本次以 Edge 執行。API/Turnstile/通知全部隔離，不建立正式預約。

已通過 18 項後端測試及瀏覽器流程檢查：週六、週日、單组容量、取消、待付款、跨日提前限制、20:00 公休區間、重複公休日合併、請求重送、付款衝突、灰色註記、選單、手機國碼、安全呈現、保證金提示、衝突後刷新、驗證到期、讀取失敗停止開放。

尚未完成：正式 Apps Script 更新及重新部署、真實 Turnstile 提交、正式通知與日曆操作、線上 edit/daily/cleanup 觸發器。沒有宣稱線上修復已完成。
