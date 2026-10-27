/*************************************************************
 * ClassCheck — API.gs
 *   เปิดช่องให้หน้าเว็บที่อยู่นอก Apps Script (เช่น GitHub Pages)
 *   คุยกับ Google Sheet เดิมได้ ข้อมูลยังอยู่ไดรฟ์ที่เดิมทุกอย่าง
 *
 *   มีไว้เพื่อให้ "กล้องสแกน" ทำงานได้ เพราะหน้าเว็บที่ Apps Script
 *   เสิร์ฟเองจะถูกวางในกรอบ iframe ที่ไม่เปิดสิทธิ์กล้อง
 *   เบราว์เซอร์จึงบล็อก getUserMedia เสมอ ไม่ว่าจะเขียนโค้ดยังไง
 *
 * วิธีติดตั้ง:
 *   1. Apps Script → ปุ่ม + ข้างคำว่า "ไฟล์" → Script
 *   2. ตั้งชื่อว่า  API
 *   3. ลบข้อความเดิมทิ้ง วางไฟล์นี้แทน → Ctrl+S
 *   4. Deploy → Manage deployments → แก้ไข → New version
 *      ★ ตั้ง "Who has access" เป็น Anyone  (สำคัญมาก)
 *      → Deploy แล้วคัดลอกลิงก์ที่ลงท้ายด้วย /exec เก็บไว้
 *
 * ★ ไฟล์นี้ใช้ doPost เท่านั้น ไม่ชนกับ doGet เดิมที่เสิร์ฟหน้าเว็บ
 * ★ ไม่ต้องแก้ รหัส.gs
 *************************************************************/

function api_json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * รับคำสั่งจากหน้าเว็บภายนอก
 * ส่งมาเป็น POST ที่ body เป็น JSON และ Content-Type เป็น text/plain
 * (ตั้ง text/plain เพื่อให้เบราว์เซอร์ไม่ต้องถาม preflight ซึ่ง Apps Script ตอบไม่ได้)
 */
function doPost(e) {
  var req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return api_json({ ok: false, error: 'อ่านคำสั่งไม่ออก' });
  }

  try {
    switch (_str(req.action)) {
      case 'ping':   return api_json({ ok: true, time: new Date().toISOString() });
      case 'init':   return api_json(api_init(req));
      case 'scan':   return api_json(api_scan(req));
      default:       return api_json({ ok: false, error: 'ไม่รู้จักคำสั่ง: ' + _str(req.action) });
    }
  } catch (err2) {
    return api_json({ ok: false, error: String(err2 && err2.message ? err2.message : err2) });
  }
}

/** รายชื่อห้อง + งานของห้องที่เลือก + จำนวนนักเรียน */
function api_init(req) {
  var classes = getSheetData('classes').map(function (c) {
    return { id: _str(c.id), name: _str(c.name) };
  });

  var cid = _str(req.classId);
  var out = { ok: true, classes: classes };
  if (!cid) return out;

  out.assignments = getSheetData('assignments')
    .filter(function (a) { return _str(a.classId) === cid || _str(a.classId) === 'ALL'; })
    .map(function (a) {
      return { id: _str(a.id), name: _str(a.name), maxScore: q_num_safe(a.maxScore) };
    });

  out.students = getSheetData('students')
    .filter(function (s) { return _str(s.classId) === cid; })
    .map(function (s) {
      return { id: _str(s.id), number: s.number, name: _str(s.name),
               code: padStudentId(s.studentId) };
    });
  return out;
}

function q_num_safe(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

/**
 * บันทึกการส่งงานจากรหัสที่สแกนมา
 * req = { classId, assignmentId, code, score (ไม่ใส่ = ได้เต็ม) }
 */
function api_scan(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT)) return { ok: false, error: 'ระบบไม่ว่าง กรุณาสแกนอีกครั้ง' };
  try {
    var cid = _str(req.classId);
    var aid = _str(req.assignmentId);
    var code = padStudentId(_str(req.code));
    if (!cid || !aid) return { ok: false, error: 'ยังไม่ได้เลือกห้องหรือชิ้นงาน' };
    if (!code) return { ok: false, error: 'ไม่พบรหัสจากการสแกน' };

    // หานักเรียนจากรหัสในห้องนี้
    var stu = null;
    getSheetData('students').forEach(function (s) {
      if (_str(s.classId) !== cid) return;
      if (padStudentId(s.studentId) === code) stu = s;
    });
    if (!stu) return { ok: false, error: 'ไม่พบรหัส ' + code + ' ในห้องนี้', code: code };

    var asg = null;
    getSheetData('assignments').forEach(function (a) { if (_str(a.id) === aid) asg = a; });
    if (!asg) return { ok: false, error: 'ไม่พบชิ้นงานนี้' };

    var maxScore = q_num_safe(asg.maxScore);
    var score = (req.score === undefined || req.score === null || req.score === '')
      ? maxScore : q_num_safe(req.score);
    if (score < 0) score = 0;
    if (maxScore > 0 && score > maxScore) score = maxScore;

    // เขียนลงตาราง submissions แบบ upsert (ส่งซ้ำ = อัปเดตคะแนนเดิม ไม่เพิ่มแถวซ้ำ)
    var ss = getDB();
    var sh = ss.getSheetByName('submissions') || ss.insertSheet('submissions');
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var headers = [], body = [];
    if (lr >= 1 && lc >= 1) {
      var all = sh.getRange(1, 1, lr, lc).getValues();
      headers = all[0].map(_str);
      body = all.slice(1);
    }
    while (headers.length && headers[headers.length - 1] === '') headers.pop();
    if (!headers.length) {
      headers = ['id', 'classId', 'studentId', 'assignmentId', 'barcode', 'score', 'date', 'time'];
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      body = [];
    }
    var iSid = headers.indexOf('studentId'), iAid = headers.indexOf('assignmentId');
    var iScore = headers.indexOf('score');
    if (iSid === -1 || iAid === -1 || iScore === -1) {
      return { ok: false, error: 'โครงสร้างตารางคะแนนไม่ถูกต้อง' };
    }

    var stamp = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd');
    var hm = Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm');
    var sid = _str(stu.id);

    for (var i = 0; i < body.length; i++) {
      var row = _fit(body[i], headers.length);
      if (_isBlankRow(row)) continue;
      if (_str(_plain(row[iSid])) !== sid) continue;
      if (_str(_plain(row[iAid])) !== aid) continue;

      var old = q_num_safe(_plain(row[iScore]));
      var merged = {};
      headers.forEach(function (h, j) { if (h) merged[h] = _plain(row[j]); });
      merged.score = score;
      merged.date = stamp;
      merged.time = hm;
      sh.getRange(i + 2, 1, 1, headers.length).setValues([_objToRow(merged, headers)]);
      return { ok: true, repeat: true, name: _str(stu.name), number: stu.number,
               code: code, score: score, maxScore: maxScore, previous: old,
               assignment: _str(asg.name) };
    }

    var rec = {
      id: Utilities.getUuid(), classId: cid, studentId: sid, assignmentId: aid,
      barcode: code, score: score, date: stamp, time: hm
    };
    sh.appendRow(_objToRow(rec, headers));
    return { ok: true, repeat: false, name: _str(stu.name), number: stu.number,
             code: code, score: score, maxScore: maxScore, assignment: _str(asg.name) };
  } finally {
    lock.releaseLock();
  }
}
