// Google Apps Script V8. Deploy backend before the matching frontend.
const SHEET_NAME = '工作室預約紀錄';
const HOLIDAY_SHEET = '公休日設定';
const SETTINGS_SHEET = '系統設定';
const SUBMISSION_SHEET = '提交紀錄';
const SENDER_NAME = 'BBAM Beautiful Body And Mind';
const REPLY_EMAIL = 'info@bbam.com.tw';
const TZ = 'Asia/Taipei';
const SLOTS = ['14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30'];
const PROPS = PropertiesService.getScriptProperties();
const LINE_TOKEN = PROPS.getProperty('LINE_TOKEN');
const LINE_GROUP_ID = PROPS.getProperty('LINE_GROUP_ID');
const SHEET_ID = PROPS.getProperty('SHEET_ID');
const CALENDAR_ID = PROPS.getProperty('CALENDAR_ID');
const META_HEADERS = ['請求ID','內容指紋','回應JSON','通知狀態JSON','日曆事件ID','日曆ID'];

function corsOutput(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function failure(code, message) { return {status:'error',code:code,message:message}; }
function database() {
  if (!SHEET_ID) throw new Error('CONFIG');
  return SpreadsheetApp.openById(SHEET_ID);
}
function bookingSheet() {
  var sheet = database().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('CONFIG');
  return sheet;
}
// Append system columns after every existing used column, including unnamed data.
function metadataColumn(sheet) {
  var col=Number(PROPS.getProperty('BOOKING_META_COLUMN'));
  if (!Number.isInteger(col) || col<9 || col+5>sheet.getMaxColumns() || JSON.stringify(sheet.getRange(1,col,1,6).getValues()[0])!==JSON.stringify(META_HEADERS)) throw new Error('系統欄位未設定或已移動，請先執行setupBookingSystem');
  return col;
}
function bookingRows(sheet) {
  var col=metadataColumn(sheet);
  return sheet.getDataRange().getValues().map(function(row){
    return Array.from({length:8},function(_,i){return row[i]===undefined?'':row[i];}).concat(Array.from({length:6},function(_,i){return row[col-1+i]===undefined?'':row[col-1+i];}));
  });
}
function setupBookingSystem() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('系統忙碌，請稍後重試');
  try {
    var ss=database(), sheet=bookingSheet(), col;
    if (PROPS.getProperty('BOOKING_META_COLUMN')) col=metadataColumn(sheet);
    else {
      var width=Math.max(8,sheet.getLastColumn()), headers=sheet.getRange(1,1,1,width).getValues()[0], matches=[];
      for(var i=8;i<=width-6;i++) if(JSON.stringify(headers.slice(i,i+6))===JSON.stringify(META_HEADERS)) matches.push(i+1);
      if(matches.length>1) throw new Error('系統欄位重複，請先確認既有欄位');
      if(matches.length===1) col=matches[0];
      else {
        if(headers.some(function(h){return META_HEADERS.indexOf(h)>=0;})) throw new Error('系統欄位不完整，請先確認既有欄位');
        col=width+1;
        if(sheet.getMaxColumns()<col+5) sheet.insertColumnsAfter(sheet.getMaxColumns(),col+5-sheet.getMaxColumns());
        sheet.getRange(1,col,1,6).setValues([META_HEADERS]);
        SpreadsheetApp.flush();
      }
      PROPS.setProperty('BOOKING_META_COLUMN',String(col));
    }
    var log = ss.getSheetByName(SUBMISSION_SHEET);
    if (!log) {
      log = ss.insertSheet(SUBMISSION_SHEET);
      log.appendRow(['提交時間毫秒','手機雜湊','請求ID','內容指紋','回應JSON','通知狀態JSON']);
      log.hideSheet();
    } else {
      var expected=['提交時間毫秒','手機雜湊','請求ID','內容指紋','回應JSON','通知狀態JSON'];
      if (JSON.stringify(log.getRange(1,1,1,6).getValues()[0]) !== JSON.stringify(expected)) throw new Error('提交紀錄欄位不符');
    }
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
function submissionSheet() {
  var sheet = database().getSheetByName(SUBMISSION_SHEET);
  if (!sheet) throw new Error('MIGRATION');
  metadataColumn(bookingSheet());
  return sheet;
}
function hash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8)
    .map(function(b) {return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
function normalizePhone(phone) {
  var s=String(phone).replace(/[\s()+-]/g,'').replace(/^'/,'');
  if (s.indexOf('886')===0) s='0'+s.slice(3);
  if (/^9\d{8}$/.test(s)) s='0'+s;
  return s;
}
function dayString(value) {
  return Object.prototype.toString.call(value)==='[object Date]' ? Utilities.formatDate(value,TZ,'yyyy-MM-dd') : String(value).trim().replace(/^'/,'');
}
function slotString(value) {
  if (Object.prototype.toString.call(value)==='[object Date]') return Utilities.formatDate(value,TZ,'HH:mm');
  var match=String(value).trim().match(/^(\d{1,2}):(\d{2})(?:\s*-.*)?$/);
  return match ? ('0'+match[1]).slice(-2)+':'+match[2] : '';
}
function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  var d=new Date(date+'T00:00:00+08:00');
  return !isNaN(d.getTime()) && dayString(d)===date;
}
function startTime(date,slot) { return new Date(date+'T'+slot+':00+08:00').getTime(); }
function inWindow(date,now) {
  if (!validDate(date)) return false;
  var today=dayString(now), parts=today.split('-').map(Number);
  var end=new Date(Date.UTC(parts[0],parts[1]+2,0));
  return date>=today && date<=end.toISOString().slice(0,10);
}
function readSettings() {
  var sheet=database().getSheetByName(SETTINGS_SHEET), settings={};
  if (!sheet) return settings;
  sheet.getDataRange().getValues().slice(1).forEach(function(row) {if(row[0]) settings[String(row[0]).trim()]=String(row[1]).trim();});
  return settings;
}
function bufferHours(settings) {
  var n=Number(settings.buffer_hours);
  return settings.buffer_hours!==undefined && Number.isFinite(n) && n>=0 && n<=168 ? n : 2;
}
function getSettings() {
  var s=readSettings();
  return {buffer_hours:String(bufferHours(s)),turnstile_site_key:s.turnstile_site_key||'',bot_required:PROPS.getProperty('ALLOW_UNPROTECTED_TEST_ONLY')!=='true'};
}
function getHolidays() {
  var sheet=database().getSheetByName(HOLIDAY_SHEET), holidays={};
  if (!sheet) return holidays;
  sheet.getDataRange().getValues().slice(1).forEach(function(row,index) {
    var date=dayString(row[0]);
    if (!validDate(date) || !row[1]) return;
    if (!row[2] || !String(row[2]).trim()) {holidays[date]={type:'closed',msg:String(row[1])};return;}
    var blocked=[];
    var valueText=Object.prototype.toString.call(row[2])==='[object Date]' ? slotString(row[2]) : String(row[2]);
    valueText.split(',').forEach(function(value) {
      var parts=value.trim().split('-');
      var validTime=function(t){return /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(t.trim());};
      if(parts.length>2 || !parts.every(validTime)) throw new Error('公休日設定第'+(index+2)+'列時段格式不正確');
      var start=slotString(parts[0]), end=slotString(parts[1]||parts[0]);
      if(start>end || (parts.length===1 && SLOTS.indexOf(start)<0)) throw new Error('公休日設定第'+(index+2)+'列時段不在可用範圍');
      SLOTS.forEach(function(slot){if(slot>=start && slot<=end && blocked.indexOf(slot)<0) blocked.push(slot);});
    });
    var existing=holidays[date];
    // Every row for a date applies: whole-day closure wins; partial rows merge.
    if(existing && existing.type==='closed') return;
    var combined=(existing ? existing.slots : []).concat(blocked);
    holidays[date]={type:'partial',msg:existing ? existing.msg : String(row[1]),slots:SLOTS.filter(function(slot){return combined.indexOf(slot)>=0;})};
  });
  return holidays;
}
function occupiesSlot(status) { return ['取消','待付款','待付保證金','未付款'].indexOf(String(status).trim())<0; }
function countLabel(count) { return Number(count)===5 ? '5 人以上' : count+' 人'; }
function availability(date,rows,holidays,settings,now) {
  if (!inWindow(date,now)) throw new Error('INVALID_DATE');
  var holiday=holidays[date], sunday=new Date(date+'T00:00:00+08:00').getUTCDay()===6;
  // Sunday in Taipei is Saturday 16:00 UTC.
  return SLOTS.map(function(slot) {
    var state='available';
    if (startTime(date,slot)<now.getTime()+bufferHours(settings)*3600000) state='past';
    else if (sunday || (holiday && (holiday.type==='closed' || holiday.slots.indexOf(slot)>=0))) state='blocked';
    else if (rows.slice(1).some(function(row) {return occupiesSlot(row[7]) && dayString(row[4])===date && slotString(row[5])===slot;})) state='full';
    return {slot:slot,state:state};
  });
}
function doGet(e) {
  try {
    var p=e.parameter||{};
    if (p.action==='getHolidays') return corsOutput({status:'ok',holidays:getHolidays()});
    if (p.action==='getSettings') return corsOutput({status:'ok',settings:getSettings()});
    if (p.action==='getAvailability') {
      if (!inWindow(String(p.date||''),new Date())) return corsOutput(failure('INVALID_INPUT','日期不在可預約範圍'));
      return corsOutput({status:'ok',date:p.date,slots:availability(p.date,bookingSheet().getDataRange().getValues(),getHolidays(),readSettings(),new Date())});
    }
    return corsOutput(failure('INVALID_ACTION','未知的 action'));
  } catch (err) { Logger.log('GET_FAILED '+String(err.message));return corsOutput(failure('SERVICE_UNAVAILABLE','讀取失敗，請稍後重試')); }
}
function validateInput(raw) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
  var fields=['name','phone','email','date','slot','requestId'];
  if (fields.some(function(k) {return typeof raw[k]!=='string';})) return null;
  var p={name:raw.name.trim(),phone:normalizePhone(raw.phone),email:raw.email.trim(),date:raw.date,slot:raw.slot,requestId:raw.requestId};
  var countText=String(raw.count);
  if ((typeof raw.count!=='number' && typeof raw.count!=='string') || !/^[1-9]\d{0,15}$/.test(countText) || !Number.isSafeInteger(Number(countText))) return null;
  p.count=Number(countText);
  if (!p.name || p.name.length>80 || /[\x00-\x1f\x7f]/.test(p.name) || !/^09\d{8}$/.test(p.phone) || raw.phone.length>30) return null;
  if (p.email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.email) || /[\x00-\x1f\x7f]/.test(p.email)) return null;
  if (!validDate(p.date) || SLOTS.indexOf(p.slot)<0 || !/^[A-Za-z0-9_-]{16,80}$/.test(p.requestId)) return null;
  p.botToken=typeof raw.botToken==='string' && raw.botToken.length<=2048 ? raw.botToken : '';
  return p;
}
function fingerprint(p) {return hash(JSON.stringify([p.name,p.phone,p.email,p.date,p.slot,p.count]));}
function verifyBot(p) {
  if (PROPS.getProperty('ALLOW_UNPROTECTED_TEST_ONLY')==='true') return null;
  var secret=PROPS.getProperty('TURNSTILE_SECRET'), hosts=PROPS.getProperty('TURNSTILE_HOSTNAMES');
  if (!secret || !hosts) return failure('BOT_UNAVAILABLE','預約驗證尚未設定，請聯繫客服');
  if (!p.botToken) return failure('BOT_REJECTED','請完成驗證後重新送出');
  try {
    var response=UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'post',payload:{secret:secret,response:p.botToken,idempotency_key:p.requestId},muteHttpExceptions:true});
    if (response.getResponseCode()!==200) return failure('BOT_UNAVAILABLE','驗證服務暫時無法使用');
    var data=JSON.parse(response.getContentText());
    if (!data.success || data.action!=='booking' || hosts.split(',').map(function(h){return h.trim();}).indexOf(data.hostname)<0) return failure('BOT_REJECTED','驗證失敗，請重新驗證');
    return null;
  } catch (err) {return failure('BOT_UNAVAILABLE','驗證服務暫時無法使用');}
}
function safeCell(value) {return /^[\s]*[=+@-]/.test(value) ? "'"+value : value;}
function doPost(e) {
  var raw;
  try {
    if (!e.postData || typeof e.postData.contents!=='string' || e.postData.contents.length>8192) return corsOutput(failure('INVALID_INPUT','提交內容不正確'));
    raw=JSON.parse(e.postData.contents);
  } catch (err) {return corsOutput(failure('INVALID_INPUT','提交內容不正確'));}
  // LINE events are not booking submissions and must not trigger notifications.
  if (raw && raw.events) return corsOutput({status:'ok'});
  var p=validateInput(raw);
  if (!p) return corsOutput(failure('INVALID_INPUT','請檢查姓名、手機、Email、人數與預約資料'));
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(5000)) return corsOutput(failure('BUSY','系統忙碌，請稍後重試'));
  var result, notify=null;
  try {
    var sheet=bookingSheet(), log=submissionSheet(), rows=bookingRows(sheet), attempts=log.getDataRange().getValues();
    var now=new Date(), digest=fingerprint(p), phoneHash=hash(p.phone);
    // Successful requests remain durable in booking rows even after ledger cleanup/cancel.
    for (var i=1;i<rows.length;i++) {
      if (rows[i][8]===p.requestId) return corsOutput(rows[i][9]===digest ? JSON.parse(rows[i][10]) : failure('REQUEST_REUSED','請求識別碼已被其他內容使用'));
    }
    for (var j=1;j<attempts.length;j++) {
      if (attempts[j][2]===p.requestId && Number(attempts[j][0])>now.getTime()-86400000) return corsOutput(attempts[j][3]===digest ? JSON.parse(attempts[j][4]) : failure('REQUEST_REUSED','請求識別碼已被其他內容使用'));
    }
    var recent=attempts.slice(1).filter(function(r){return r[1]===phoneHash && Number(r[0])>now.getTime()-60000;});
    if (recent.length>=3) return corsOutput(failure('RATE_LIMIT','同一手機60秒內最多提交3次，請稍後再試'));
    var currentState=inWindow(p.date,now) ? availability(p.date,rows,getHolidays(),readSettings(),now).filter(function(s){return s.slot===p.slot;})[0].state : 'blocked';
    var pending=rows.slice(1).filter(function(r){return occupiesSlot(r[7]) && normalizePhone(r[2])===p.phone && validDate(dayString(r[4])) && startTime(dayString(r[4]),slotString(r[5]))>now.getTime();}).length;
    if (currentState==='full') result=failure('SLOT_FULL','此時段已預約，請選擇其他時段');
    else if (currentState!=='available') result=failure('UNAVAILABLE','此日期或時段不開放預約');
    else if (pending>=3) result=failure('BOOKING_LIMIT','同一手機最多保留3筆尚未到期的預約');
    else result=verifyBot(p);
    var badRecords=[];
    if (!result) {
      badRecords=checkPhoneRecord(p.phone);
      if (badRecords.length) result={status:'warning',message:'deposit_required'};
      else result={status:'ok',message:'預約成功'};
    }
    var bookingRow=null;
    if (result.status==='ok') {
      var record=[Utilities.formatDate(now,TZ,'yyyy-MM-dd HH:mm:ss'),safeCell(p.name),"'"+p.phone,safeCell(p.email),p.date,p.slot,countLabel(p.count),'確認'];
      while(record.length<metadataColumn(sheet)-1) record.push('');
      sheet.appendRow(record.concat([p.requestId,digest,JSON.stringify(result),'{}','','']));
      bookingRow=sheet.getLastRow();
    }
    log.appendRow([now.getTime(),phoneHash,p.requestId,digest,JSON.stringify(result),'{}']);
    SpreadsheetApp.flush();
    if (result.status==='ok' || result.status==='warning') notify={sheet:bookingRow ? sheet : log,row:bookingRow||log.getLastRow(),col:bookingRow ? metadataColumn(sheet)+3 : 6,booking:!!bookingRow,p:p,badRecords:badRecords};
  } catch (err) {
    Logger.log('POST_FAILED');result=failure('SERVICE_UNAVAILABLE','處理結果尚未確認，請保留原資料重試或聯繫客服');
  } finally {lock.releaseLock();}
  if (notify) {
    try { deliverNotifications(notify); } catch (err) {Logger.log('NOTIFICATION_STATE_FAILED');}
  }
  return corsOutput(result);
}
// At-most-once external attempts: claim and flush before sending, never resend on POST replay.
function attemptOnce(sheet,row,col,key,send) {
  var lock=LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    if (sheet.getName()===SHEET_NAME && (['calendar','line','email'].indexOf(key)>=0 || key.indexOf('reminder_')===0) && String(sheet.getRange(row,8).getValue()).trim()==='取消') return;
    var states=JSON.parse(sheet.getRange(row,col).getValue()||'{}');
    if (states[key]) return;
    states[key]='attempting';sheet.getRange(row,col).setValue(JSON.stringify(states));SpreadsheetApp.flush();
    try {send();states[key]='sent';} catch(err) {states[key]='failed';Logger.log('NOTIFICATION_FAILED '+key);}
    sheet.getRange(row,col).setValue(JSON.stringify(states));SpreadsheetApp.flush();
  } finally {lock.releaseLock();}
}
function deliverNotifications(n) {
  var p=n.p;
  if (n.booking) {
    attemptOnce(n.sheet,n.row,n.col,'calendar',function(){
      var event=addEventToCalendar(p.name,p.phone,p.email,p.date,p.slot,countLabel(p.count));
      n.sheet.getRange(n.row,metadataColumn(n.sheet)+4,1,2).setValues([[event.eventId,event.calendarId]]);
    });
  }
  attemptOnce(n.sheet,n.row,n.col,'line',function(){sendLineMessage(p.name,p.phone,p.date,p.slot,countLabel(p.count),n.badRecords);});
  if (n.booking) attemptOnce(n.sheet,n.row,n.col,'email',function(){sendConfirmEmail(p.email,p.name,p.date,p.slot,countLabel(p.count));});
}
function checkPhoneRecord(phone) {
  return bookingSheet().getDataRange().getValues().slice(1).filter(function(r) {return normalizePhone(r[2])===phone && ['爽約','逾時'].indexOf(String(r[7]).trim())>=0;})
    .map(function(r){return{status:String(r[7]).trim(),date:dayString(r[4])};});
}
function addEventToCalendar(name, phone, email, date, slot, count) {
  var cal;

  if (CALENDAR_ID && CALENDAR_ID.trim() !== "") {
    cal = CalendarApp.getCalendarById(CALENDAR_ID.trim());
    if (!cal) {
      throw new Error("無法透過 CALENDAR_ID (" + CALENDAR_ID + ") 取得日曆物件。請確認該日曆是否已正確共用給此指令碼的擁有者帳號，或 ID 是否正確。");
    }
  } else {
    cal = CalendarApp.getDefaultCalendar();
  }

  // 處理時間 slot (例如 slot 是 "14:00" 或 "14:00-15:00")
  var startTimeStr = slot;
  var endTimeStr = "";

  if (slot.indexOf('-') !== -1) {
    var parts = slot.split('-');
    startTimeStr = parts[0].trim();
    endTimeStr = parts[1].trim();
  }

  var startDateTime = new Date(date + 'T' + startTimeStr + ':00+08:00');
  var endDateTime;

  if (endTimeStr) {
    endDateTime = new Date(date + 'T' + endTimeStr + ':00+08:00');
  } else {
    endDateTime = new Date(startDateTime.getTime() + 30 * 60000);
  }

  var title = '【預約】' + name + ' (' + count + ')';
  var description = '姓名：' + name + '\n電話：' + phone + '\n信箱：' + email + '\n人數：' + count + '\n地點：台中市中區三民路二段46號8樓-2';
  var location = '台中市中區三民路二段46號8樓-2';

  var event=cal.createEvent(title, startDateTime, endDateTime, {
    description: description,
    location: location
  });

  return {eventId:event.getId(),calendarId:cal.getId()};
}

// 查詢手機號碼是否有爽約/逾時紀錄
function sendLineText(text) {
  if (!LINE_TOKEN || !LINE_GROUP_ID) throw new Error('LINE_CONFIG');
  var r=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{method:'post',headers:{'Content-Type':'application/json','Authorization':'Bearer '+LINE_TOKEN},payload:JSON.stringify({to:LINE_GROUP_ID,messages:[{type:'text',text:text}]}),muteHttpExceptions:true});
  if (r.getResponseCode()<200 || r.getResponseCode()>=300) throw new Error('LINE_FAILED');
}
function sendLineMessage(name, phone, date, slot, count, badRecords) {
  var warning = '';
  if (badRecords && badRecords.length > 0) {
    badRecords.forEach(function(r) {
      warning += '\n⚠️ 此人曾於 ' + r.date + ' 有' + r.status + '紀錄，尚未成立且不保留時段；確認付款時請重新檢查是否仍有空位';
    });
  }
  var msg =
    '新預約通知\n' +
    '──────────\n' +
    '姓名：' + name + '\n' +
    '電話：' + phone + '\n' +
    '日期：' + date + '\n' +
    '時段：' + slot + '\n' +
    '人數：' + count +
    warning + '\n' +
    '──────────';
  sendLineText(msg);
}
function escapeHtml(value) {return String(value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function sendConfirmEmail(email, name, date, slot, count) {
  name=escapeHtml(name); date=escapeHtml(date); slot=escapeHtml(slot); count=escapeHtml(count);
  var subject = '【BBAM】預約確認通知';
  var htmlBody =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
    '<h2 style="color:#2c4a6e;font-weight:300;margin-bottom:16px">預約確認通知</h2>' +
    '<p>親愛的 <strong>' + name + '</strong> 您好，</p>' +
    '<p style="margin-top:12px">感謝您的預約，以下是您的預約資訊：</p>' +
    '<table style="margin-top:16px;border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e;width:80px">日期</td><td style="padding:8px;background:#f7faff">' + date + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e">時段</td><td style="padding:8px;background:#f7faff">' + slot + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e">人數</td><td style="padding:8px;background:#f7faff">' + count + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:16px;color:#666">地址：台中市中區三民路二段46號8樓-2</p>' +
    '<p style="margin-top:24px;color:#666">如需更改或取消預約，請直接聯繫LINE客服。</p>' +
    '</div>';
  MailApp.sendEmail(email, subject, '', {
    name: SENDER_NAME,
    replyTo: REPLY_EMAIL,
    htmlBody: htmlBody
  });
}
function sendReminderEmail(email, name, date, slot, count) {
  name=escapeHtml(name); date=escapeHtml(date); slot=escapeHtml(slot); count=escapeHtml(count);
  var subject = '【BBAM】今日預約提醒';
  var htmlBody =
    '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">' +
    '<h2 style="color:#2c4a6e;font-weight:300;margin-bottom:16px">今日預約提醒</h2>' +
    '<p>親愛的 <strong>' + name + '</strong> 您好，</p>' +
    '<p style="margin-top:12px">提醒您今天有預約工作室試穿，期待您的到來！</p>' +
    '<table style="margin-top:16px;border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e;width:80px">日期</td><td style="padding:8px;background:#f7faff">' + date + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e">時段</td><td style="padding:8px;background:#f7faff">' + slot + '</td></tr>' +
    '<tr><td style="padding:8px;background:#f0f5ff;color:#5a7a9e">人數</td><td style="padding:8px;background:#f7faff">' + count + '</td></tr>' +
    '</table>' +
    '<p style="margin-top:16px;color:#666">地址：台中市中區三民路二段46號8樓-2</p>' +
    '<p style="margin-top:24px;color:#666">如需更改或取消，請於中午 12:00 前聯繫LINE客服。</p>' +
    '</div>';

  MailApp.sendEmail(email, subject, '', {
    name: SENDER_NAME,
    replyTo: REPLY_EMAIL,
    htmlBody: htmlBody
  });
}
function sendLineCancelNotify(name, phone, date, slot, count) {
  var msg =
    '取消預約通知\n' +
    '──────────\n' +
    '姓名：' + name + '\n' +
    '電話：' + phone + '\n' +
    '日期：' + date + '\n' +
    '時段：' + slot + '\n' +
    '人數：' + count + '\n' +
    '──────────';
  sendLineText(msg);
}

function onSheetEdit(e) {
  if (!e || !e.range || !e.source) return;
  var sheet=e.range.getSheet ? e.range.getSheet() : e.source.getActiveSheet();
  if (sheet.getName()!==SHEET_NAME || e.range.getColumn()>8 || e.range.getColumn()+e.range.getNumColumns()-1<8) return;
  for (var i=Math.max(2,e.range.getRow());i<e.range.getRow()+e.range.getNumRows();i++) {
    var row=bookingRows(sheet)[i-1];
    if (String(row[7]).trim()!=='取消') continue;
    if (row[12] && row[13]) attemptOnce(sheet,i,metadataColumn(sheet)+3,'calendar_cancel',function(){
      var cal=CalendarApp.getCalendarById(row[13]), event=cal && cal.getEventById(row[12]);
      if (!cal) throw new Error('CALENDAR_UNAVAILABLE');
      if (event) event.deleteEvent();
    });
    attemptOnce(sheet,i,metadataColumn(sheet)+3,'cancel_line',function(){sendLineCancelNotify(row[1],normalizePhone(row[2]),dayString(row[4]),slotString(row[5]),row[6]);});
  }
}
function sendDailyReminders() {
  var sheet=bookingSheet(), rows=bookingRows(sheet), today=dayString(new Date());
  rows.slice(1).forEach(function(row,index) {
    if (!occupiesSlot(row[7]) || ['爽約','逾時'].indexOf(String(row[7]).trim())>=0 || dayString(row[4])!==today || !row[3]) return;
    attemptOnce(sheet,index+2,metadataColumn(sheet)+3,'reminder_'+today,function(){sendReminderEmail(row[3],row[1],today,slotString(row[5]),row[6]);});
  });
}
function cleanupSubmissionLog() {
  var lock=LockService.getScriptLock();if (!lock.tryLock(5000)) return;
  try {
    var sheet=submissionSheet(), rows=sheet.getDataRange().getValues(), cutoff=Date.now()-86400000;
    for (var i=rows.length-1;i>=1;i--) if(Number(rows[i][0])<=cutoff) sheet.deleteRows(i+1,1);
    SpreadsheetApp.flush();
  } finally {lock.releaseLock();}
}

// Staff-only function: select a 待付款 row after checking the bank transfer,
// then run this function in Apps Script. It is never exposed by doGet/doPost.
function confirmDepositBooking(rowNumber) {
  if (!Number.isInteger(rowNumber) || rowNumber<2) throw new Error('請提供待付款資料列的列號');
  return confirmDepositRow(bookingSheet(),rowNumber);
}
function confirmDepositBookingFromSelectedRow() {
  var active=SpreadsheetApp.getActiveSpreadsheet();
  if (!active || active.getId()!==SHEET_ID) throw new Error('請在指定預約試算表選取待付款資料列');
  var selected=active.getActiveRange(), sheet=selected && selected.getSheet();
  if (!sheet || sheet.getName()!==SHEET_NAME || selected.getRow()<2 || selected.getNumRows()!==1) throw new Error('請選取一筆待付款預約');
  return confirmDepositRow(sheet,selected.getRow());
}
function confirmDepositRow(sheet,index) {
  var lock=LockService.getScriptLock(), notification;
  if (!lock.tryLock(5000)) throw new Error('系統忙碌，請稍後重試');
  try {
    var rows=bookingRows(sheet), row=rows[index-1];
    if (!row || ['待付款','待付保證金','未付款'].indexOf(String(row[7]).trim())<0) throw new Error('僅能確認待付款預約');
    var raw={name:String(row[1]).replace(/^'/,''),phone:normalizePhone(row[2]),email:String(row[3]).replace(/^'/,''),date:dayString(row[4]),slot:slotString(row[5]),count:parseInt(String(row[6]),10),requestId:row[8]||Utilities.getUuid()};
    var p=validateInput(raw);
    if (!p) throw new Error('預約資料不完整，請確認姓名、手機、Email、日期、時段與人數');
    var now=new Date(), state=inWindow(p.date,now)?availability(p.date,rows,getHolidays(),readSettings(),now).filter(function(s){return s.slot===p.slot;})[0].state:'blocked';
    if (state!=='available') throw new Error('此時段已無空位或不開放，請聯繫客人另選時段；本筆仍維持待付款');
    var pending=rows.slice(1).filter(function(r){return occupiesSlot(r[7])&&normalizePhone(r[2])===p.phone&&validDate(dayString(r[4]))&&startTime(dayString(r[4]),slotString(r[5]))>now.getTime();}).length;
    if(pending>=3)throw new Error('同一手機最多保留3筆尚未到期的預約');
    var col=metadataColumn(sheet), result={status:'ok',message:'預約成功'};
    sheet.getRange(index,col,1,6).setValues([[p.requestId,fingerprint(p),JSON.stringify(result),'{}','','']]);
    sheet.getRange(index,8).setValue('確認');SpreadsheetApp.flush();
    notification={sheet:sheet,row:index,col:col+3,booking:true,p:p,badRecords:[]};
  } finally {lock.releaseLock();}
  deliverNotifications(notification);
  return {status:'ok',message:'付款確認完成，預約已成立'};
}
