# BBAM 線上預約系統

## 專案概述

BBAM 線上預約系統是為瑜伽工作室「BBAM Beautiful Body And Mind」開發的完整線上預約平台。系統提供使用者友善的介面，支援日期選擇、時段預約、客戶資料填寫等核心功能。

營業時間：週一至週六 14:00-20:00（最晚預約 19:30）
週日休息

## 核心功能

日期選擇
- 互動式日曆介面
- 公休日設定顯示
- 週六免預約開放日標示
- 過去日期禁用

時段管理
- 14:00-19:30 時段選擇（30 分鐘間隔）
- 週六免預約功能
- 動態時段狀態更新

預約資訊收集
- 姓名、手機號碼、電郵
- 預約人數選擇
- 政策同意確認

客戶管理
- 爽約/逾時記錄檢查
- LINE 訊息通知
- 確認郵件寄送

## 技術棧

前端
- HTML5 - 網頁結構
- CSS3 - 響應式設計（Grid、Flexbox、media queries）
- Vanilla JavaScript - 無框架純 JS 實現
- Google Fonts - 繁體中文字型（Noto Sans TC、Noto Serif TC）

後端
- Google Apps Script - 無伺服器後端
- Google Sheets - 資料存儲
- LINE Bot API - 實時通知
- Gmail API - 郵件寄送

## 專案結構

```
bbam_booking/
├── frontend/
│   └── index.html          # 主頁面（完整 HTML+CSS+JS）
├── backend/
│   └── code.js             # Google Apps Script 後端邏輯
├── README.md               # 本文件
└── .git/                   # 版本控制
```

## 部署說明

### 前端部署

1. 開啟 `frontend/index.html` 在瀏覽器中
2. 修改 API 端點為 Google Apps Script 部署網址

### 後端部署

1. 建立 Google Sheet，包含以下工作表：
   - 工作室預約紀錄
   - 公休日設定
   - 系統設定

2. 建立 Google Apps Script 專案
   - 複製 `backend/code.js` 內容
   - 在指令碼屬性中設定以下變數：
     - SHEET_ID: Google Sheet ID
     - LINE_TOKEN: LINE Bot Token
     - LINE_GROUP_ID: LINE 群組 ID
     - REPLY_EMAIL: 回覆郵箱

3. 部署為網頁應用
   - 新增版本部署
   - 設定權限為 "Anyone"

## 使用者流程

1. 載入系統 - 獲取公休日與系統設定
2. 選擇日期 - 日曆介面選擇預約日期
3. 選擇時段 - 展示可用時段供使用者選擇
4. 填寫資料 - 輸入聯絡資訊與參加人數
5. 提交預約 - 驗證後存儲預約資訊並寄送通知
6. 確認訊息 - 顯示成功畫面

## 資安考量

敏感資訊管理
- API Token 及 Sheet ID 存儲在 Google Apps Script 屬性中
- 前端代碼不包含任何硬編碼的密鑰
- LINE Bot Token 和郵箱設定應透過環境變數管理

推薦做法
- 定期更新 LINE Bot Token
- 監控 Google Sheet 存取權限
- 保持 Google Apps Script 版本控制

## 資料存儲結構

### 工作室預約紀錄表

| 時間戳 | 姓名 | 電話 | 郵箱 | 日期 | 時段 | 人數 | 狀態 |
|--------|------|------|------|------|------|------|------|
| 2026-05-20 14:30 | 張小寶 | 0912345678 | | 2026-05-20 | 14:00 | 1 | 確認 |

### 公休日設定表

| 日期 | 說明 | 時段限制 |
|------|------|---------|
| 2026-05-26 | 店主進修 | 14:00-15:30 |
| 2026-06-02 | 年度公休 | |

## 色彩設計

系統採用統一的色彩變量以確保視覺一致性

主色系
- 主色：#5a89b8（藍色）
- 背景：#f0f5ff（淺藍白）
- 文字：#2c4a6e（深藍灰）

狀態色
- 可預約：#86a6ca
- 週六免預約：#6aaa7a（綠色）
- 公休：#b06060（紅色）

## 響應式設計

支援所有裝置尺寸
- 移動裝置：3 欄時段網格
- 平板及以上：4 欄時段網格
- 字體大小動態調整（使用 clamp 函數）
- 安全區域適配（刀屏手機）

## 開發環境要求

- 現代瀏覽器（Chrome、Firefox、Safari、Edge）
- Google 帳戶（用於 Google Sheets 和 Apps Script）
- LINE 官方帳號（用於通知功能）

## 版本管理

本專案使用 Git 進行版本控制。提交時應避免包含：
- `.env` 或敏感設定檔
- 本地開發設定
- 個人 API Token

## 聯絡資訊

BBAM Beautiful Body And Mind 工作室

## 授權

Copyright © Kobishi. All rights reserved.
