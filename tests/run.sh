#!/bin/bash
# รันตัวทดสอบทั้งหมด — ต้องเจอคำว่า "ALL PASS" ในผลของทุกไฟล์
#
# ไม่ต้องลง dependency อะไรเลย:
#   · ฝั่งไพทอน ใช้ของปลอมของ fastapi ใน tests/stubs (เซิร์ฟเวอร์ใช้แค่สามอย่าง
#     จาก fastapi จึงปลอมได้ครบ) — เรียกฟังก์ชันของ mock_api ตรง ๆ ไม่ผ่าน HTTP
#   · ฝั่ง TypeScript ใช้ node รันไฟล์ .ts ได้เองตั้งแต่ node 22
#
# ตัวทดสอบอยู่ใน repo เพราะตัวทดสอบที่อยู่ที่อื่นหายไปพร้อมเครื่องชั่วคราวทุกครั้ง
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
pass=0; fail=0

for f in "$HERE"/py/*.py; do
  [ -e "$f" ] || continue
  cd "$ROOT" || exit 1
  rm -f data_state.json
  out=$(PYTHONPATH="$HERE/stubs:$ROOT" python3 "$f" 2>&1)
  if echo "$out" | grep -q "ALL PASS"; then pass=$((pass+1)); echo "ok   py/$(basename "$f")"
  else fail=$((fail+1)); echo "FAIL py/$(basename "$f")"; echo "$out" | tail -20 | sed 's/^/     /'; fi
done
rm -f "$ROOT/data_state.json"

for f in "$HERE"/ts/*.ts; do
  [ -e "$f" ] || continue
  out=$(cd "$HERE" && node --import ./register.mjs "$f" 2>&1)
  if echo "$out" | grep -q "ALL PASS"; then pass=$((pass+1)); echo "ok   ts/$(basename "$f")"
  else fail=$((fail+1)); echo "FAIL ts/$(basename "$f")"; echo "$out" | tail -20 | sed 's/^/     /'; fi
done

echo "— ผ่าน $pass · ไม่ผ่าน $fail —"
[ "$fail" -eq 0 ]
