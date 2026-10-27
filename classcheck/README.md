# ClassCheck — ส่วนที่ต้องใช้กล้อง

โฟลเดอร์นี้มีหน้าเว็บที่วางบน **GitHub Pages** เพื่อให้ "เปิดกล้องสแกนบัตร" ทำงานได้
ข้อมูลทั้งหมด (ห้องเรียน นักเรียน คะแนน) **ยังอยู่ใน Google Sheet เดิม** ไม่ได้ย้ายไปไหน

## ทำไมต้องแยกมาไว้ที่นี่

Apps Script เสิร์ฟหน้าเว็บโดยวางไว้ในกรอบ `<iframe>` ที่ไม่ได้ใส่ `allow="camera"`
เบราว์เซอร์จึงบล็อก `getUserMedia()` เสมอ แก้ที่โค้ดฝั่งแอปไม่ได้เลย
หน้าที่วางบน GitHub Pages ไม่มีกรอบครอบ กล้องจึงทำงานได้ปกติ

## ไฟล์ในโฟลเดอร์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าแรก + คู่มือตั้งค่า |
| `scan.html` | หน้าสแกนบัตรส่งงาน (ใช้กล้องจริง) |
| `API.gs` | โค้ดฝั่ง Apps Script เปิดช่องให้หน้าเว็บนี้อ่าน/เขียนชีตได้ |

## ติดตั้ง

1. **ฝั่ง Apps Script** — เพิ่มไฟล์สคริปต์ใหม่ชื่อ `API` วางเนื้อหา `API.gs`
   แล้ว Deploy → Manage deployments → New version → **Who has access = Anyone**
   คัดลอกลิงก์ที่ลงท้าย `/exec`
2. **ฝั่ง GitHub** — Settings → Pages → Source = `Deploy from a branch`,
   Branch = `main`, Folder = `/ (root)` → Save
   หน้าจะอยู่ที่ `https://<user>.github.io/school-scheduler/classcheck/`
3. เปิดหน้าสแกน วางลิงก์ `/exec` → เชื่อมต่อ (เครื่องจะจำไว้ให้)

## API ที่เปิดไว้

ส่งเป็น `POST` body เป็น JSON และ `Content-Type: text/plain;charset=utf-8`
(ตั้ง text/plain เพื่อไม่ให้เบราว์เซอร์ยิง CORS preflight ซึ่ง Apps Script ตอบไม่ได้)

| action | ส่งไป | ได้กลับ |
|---|---|---|
| `ping` | — | `{ok, time}` |
| `init` | `classId` (ไม่ใส่ = ขอแค่รายชื่อห้อง) | `{ok, classes, assignments, students}` |
| `scan` | `classId, assignmentId, code, score?` | `{ok, repeat, name, number, score, maxScore, previous?}` |

`scan` เป็น upsert — สแกนซ้ำคนเดิมจะอัปเดตคะแนนแถวเดิม ไม่เพิ่มแถวซ้ำ
และคืน `repeat: true` พร้อมคะแนนเดิมใน `previous`

`API.gs` ใช้ `doPost` เท่านั้น ไม่ชนกับ `doGet` เดิมที่เสิร์ฟหน้าแอป และไม่ต้องแก้ `รหัส.gs`
