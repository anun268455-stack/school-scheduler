"""
เทอม: ตารางเก็บไฟล์เทอมในฐานข้อมูล และรายการเทอม

ตัวทดสอบชุดนี้ไม่ต่อฐานข้อมูลจริง — ตรวจสิ่งที่ตรวจได้โดยไม่มีฐานข้อมูล
คือชื่อเทอม ข้อความปฏิเสธ รูปแบบคำตอบเมื่อไม่มีฐานข้อมูล และคำสั่งสร้างตาราง
"""
import sys

import mock_api

fails: list[str] = []


def ok(cond: object, what: str) -> None:
    if not cond:
        fails.append(what)


def test_term_label():
    assert mock_api.term_label(2569, 1) == "1/2569"
    assert mock_api.term_label(2568, 2) == "2/2568"


def test_require_db_refuses_without_postgres():
    mock_api._STORE_KIND = "file"
    try:
        mock_api._require_db()
        assert False, "ต้องยก HTTPException"
    except Exception as exc:
        assert "ยังไม่ได้ต่อฐานข้อมูล" in str(exc)
        ok(isinstance(exc, mock_api.HTTPException) and exc.status_code == 400,
           "ปฏิเสธด้วย HTTPException 400")


def test_terms_list_reports_unavailable_without_postgres():
    mock_api._STORE_KIND = "file"
    out = mock_api.list_terms()
    assert out["available"] is False
    assert out["terms"] == []
    ok("ยังไม่ได้ต่อฐานข้อมูล" in out.get("reason", ""), "บอกเหตุผลเป็นภาษาไทย")


def test_terms_schema_has_unique_year_semester():
    # ปี+ภาคเรียนซ้ำต้องถูกฐานข้อมูลปฏิเสธ ไม่ใช่แค่โค้ดตรวจ (Review Focus 3)
    assert "UNIQUE (year, semester)" in mock_api._TERMS_SCHEMA
    assert "app_terms" in mock_api._TERMS_SCHEMA


def test_terms_list_survives_database_error():
    # ฐานข้อมูลล่ม: หน้าจอยังต้องเปิดได้ และข้อความต้องไม่รั่วรายละเอียดการเชื่อมต่อ
    saved = mock_api._db_connect

    def boom():
        raise RuntimeError("postgresql://user:SECRET@host/db")
    mock_api._STORE_KIND = "postgres"
    mock_api._db_connect = boom
    try:
        out = mock_api.list_terms()
    finally:
        mock_api._db_connect = saved
        mock_api._STORE_KIND = "file"
    ok(out["available"] is False and out["terms"] == [], "ฐานข้อมูลล่ม = available False")
    ok("SECRET" not in str(out), "ไม่เอาข้อความผิดพลาดดิบ (อาจมีรหัสผ่าน) ไปให้หน้าจอ")


def test_terms_schema_columns_and_list_has_no_data():
    s = mock_api._TERMS_SCHEMA
    for col in ("id        bigserial PRIMARY KEY", "status    text NOT NULL",
                "data      bytea NOT NULL", "closed_at timestamptz"):
        ok(col in s, f"คอลัมน์ {col}")
    ok("length(data)" in mock_api._TERM_COLUMNS and "data," not in mock_api._TERM_COLUMNS,
       "รายการวัดขนาดด้วย length(data) ไม่โหลดก้อนข้อมูล")


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        fn()

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
