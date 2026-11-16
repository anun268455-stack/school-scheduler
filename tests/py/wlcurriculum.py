"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 2: หลักสูตรของภาคเรียน — ตาราง route บันทึกการแก้ และการตั้งต้น

ฟังก์ชันล้วนเรียกตรง ๆ · route คุยกับ "ฐานข้อมูลปลอม" ในหน่วยความจำที่อ่านโครงตารางจาก _WL_SCHEMA เอง
(คอลัมน์ ค่าตั้งต้น NOT NULL UNIQUE/PRIMARY KEY และ ON DELETE CASCADE) แล้วตีความ SQL ชุดเล็กที่ route ใช้
คอลัมน์ที่สะกดผิดหรือ SQL รูปที่ไม่รู้จักทำให้ตัวทดสอบล้มทันที · การเรียก route ที่ยกข้อผิดพลาดย้อนข้อมูลกลับ
เหมือนธุรกรรมที่ล้ม · ของจริง (Postgres) ลองแยกกับเซิร์ฟเวอร์จริงก่อนรายงาน
"""
import collections
import contextlib
import copy
import datetime as dt
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

import mock_api

fails: list[str] = []


# ── ฐานข้อมูลปลอม ──────────────────────────────────────────────────────
class DbError(Exception):
    def __init__(self, sqlstate, msg=""):
        super().__init__(msg or sqlstate)
        self.sqlstate = sqlstate


def _parse_default(text):
    t = text.strip()
    if t.startswith("'"):
        val = t[1:t.index("'", 1)]
        if t.endswith("::jsonb"):
            return json.loads(val)
        return [] if val == "{}" else val
    if t.lower() in ("true", "false"):
        return t.lower() == "true"
    if t.lower() == "now()":
        return "NOW"
    return int(t)


def _parse_schema(sql):
    tables = {}
    for name, body in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", sql, re.S):
        t = {"cols": {}, "unique": [], "cascade": []}
        for raw in body.strip().splitlines():
            line = raw.strip().rstrip(",")
            if not line:
                continue
            word = line.split()[0]
            if word.upper() in ("UNIQUE", "PRIMARY"):
                cols = re.search(r"\((.*?)\)", line).group(1)
                t["unique"].append(tuple(c.strip() for c in cols.split(",")))
                continue
            if word.upper() == "CHECK":
                continue
            d = re.search(r"DEFAULT\s+('[^']*'(?:::\w+)?|\S+)", line)
            t["cols"][word] = {"serial": line.split()[1] == "bigserial",
                               "notnull": "NOT NULL" in line or "PRIMARY KEY" in line,
                               "default": _parse_default(d.group(1)) if d else None,
                               "has_default": d is not None}
            if "PRIMARY KEY" in line or re.search(r"\bUNIQUE\b", line):
                t["unique"].append((word,))
            m = re.search(r"REFERENCES (\w+)\(id\)", line)
            if m and "ON DELETE CASCADE" in line:
                t["cascade"].append((m.group(1), word))
        tables[name] = t
    return tables


class FakeDb:
    def __init__(self):
        self.schema = _parse_schema(mock_api._WL_SCHEMA)
        self.tables = {n: [] for n in self.schema}
        self.seq = {n: 0 for n in self.schema}
        self.tick = 0

    def make_row(self, table, values):
        cols = self.schema[table]["cols"]
        for k in values:
            assert k in cols, f"ตาราง {table} ไม่มีคอลัมน์ {k}"
        row = {}
        for c, info in cols.items():
            if c in values:
                row[c] = copy.deepcopy(values[c])
            elif info["serial"]:
                self.seq[table] += 1
                row[c] = self.seq[table]
            elif info["default"] == "NOW":
                row[c] = dt.datetime(2026, 11, 16, 9, 0, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=self.tick)
            else:
                row[c] = copy.deepcopy(info["default"])
            if row[c] is None and info["notnull"]:
                raise DbError("23502", f"{table}.{c} ห้ามว่าง")
        return row

    def clash(self, table, row, skip=None):
        for cols in self.schema[table]["unique"]:
            key = tuple(row[c] for c in cols)
            if any(v is None for v in key):
                continue
            for other in self.tables[table]:
                if other is not skip and tuple(other[c] for c in cols) == key:
                    return cols
        return None

    def add(self, table, **values):
        row = self.make_row(table, values)
        assert self.clash(table, row) is None, (table, values)
        self.tables[table].append(row)
        return row

    def remove(self, table, rows):
        ids = {r["id"] for r in rows if "id" in r}
        self.tables[table] = [r for r in self.tables[table] if not any(r is x for x in rows)]
        for child, t in self.schema.items():
            for parent, col in t["cascade"]:
                if parent == table:
                    self.remove(child, [r for r in self.tables[child] if r[col] in ids])

    def count(self, table, **where):
        return sum(1 for r in self.tables[table] if all(r[k] == v for k, v in where.items()))


class FakeCur:
    def __init__(self, db, session_row):
        self.db, self.session_row = db, session_row
        self.log: list[tuple[str, tuple]] = []
        self._out: list[tuple] = []
        self.rowcount = 0

    def execute(self, sql, params=()):
        s = " ".join(sql.split())
        params = list(params or ())
        self.log.append((s, tuple(params)))
        if "wl_sessions" in s:
            self._out = [self.session_row] if self.session_row else []
            return
        self.db.tick += 1
        verb = s.split()[0].upper()
        assert verb in ("SELECT", "INSERT", "UPDATE", "DELETE"), s
        getattr(self, "_" + verb.lower())(s, params)

    def executemany(self, sql, seq):
        for p in seq:
            self.execute(sql, p)

    def fetchall(self):
        return list(self._out)

    def fetchone(self):
        return self._out[0] if self._out else None

    def _pred(self, table, text, params):
        cols = self.db.schema[table]["cols"]
        conds = []
        for c in (text.split(" AND ") if text else []):
            c = c.strip()
            m = (re.fullmatch(r"(\w+) = ANY\(%s\)", c) or re.fullmatch(r"(\w+) (=|<>) %s", c)
                 or re.fullmatch(r"(\w+) = '([^']*)'", c) or re.fullmatch(r"(\w+) IS (NOT )?NULL", c))
            assert m, f"ฐานข้อมูลปลอมไม่รู้จักเงื่อนไข: {c}"
            k = m.group(1)
            assert k in cols, f"ตาราง {table} ไม่มีคอลัมน์ {k}"
            if "ANY" in c:
                v = list(params.pop(0))
                conds.append(lambda r, k=k, v=v: r[k] in v)
            elif "%s" in c:
                v, op = params.pop(0), m.group(2)
                if op == "=":
                    conds.append(lambda r, k=k, v=v: r[k] is not None and v is not None and r[k] == v)
                else:
                    conds.append(lambda r, k=k, v=v: r[k] is not None and v is not None and r[k] != v)
            elif "IS" in c:
                conds.append(lambda r, k=k, neg=bool(m.group(2)): (r[k] is not None) == neg)
            else:
                conds.append(lambda r, k=k, v=m.group(2): r[k] == v)
        return lambda r: all(f(r) for f in conds)

    def _ret(self, table, ret, rows):
        if not ret:
            return []
        cols = [c.strip() for c in ret.split(",")]
        for c in cols:
            assert c in self.db.schema[table]["cols"], f"ตาราง {table} ไม่มีคอลัมน์ {c}"
        return [tuple(copy.deepcopy(r[c]) for c in cols) for r in rows]

    def _select(self, s, params):
        m = re.fullmatch(r"SELECT (DISTINCT )?(.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+?))?"
                         r"(?: LIMIT (\d+))?", s)
        assert m, f"ฐานข้อมูลปลอมไม่รู้จัก SQL: {s}"
        distinct, cols, table, where, order, limit = m.groups()
        pred = self._pred(table, where, params)
        rows = [r for r in self.db.tables[table] if pred(r)]
        for part in reversed((order or "").split(",") if order else []):
            bits = part.split()
            k, desc = bits[0], len(bits) > 1 and bits[1].upper() == "DESC"
            rows.sort(key=lambda r, k=k: (r[k] is None, r[k] if r[k] is not None else 0), reverse=desc)
        names = [c.strip() for c in cols.split(",")]
        out = [tuple(1 if c == "1" else copy.deepcopy(r[c]) for c in names) for r in rows]
        if distinct:
            out = list(dict.fromkeys(out))
        if limit:
            out = out[:int(limit)]
        self._out, self.rowcount = out, len(out)

    def _insert(self, s, params):
        m = re.fullmatch(r"INSERT INTO (\w+) \((.+?)\) VALUES \((.+?)\)(?: ON CONFLICT \((\w+)\) DO NOTHING)?"
                         r"(?: RETURNING (.+))?", s)
        assert m, f"ฐานข้อมูลปลอมไม่รู้จัก SQL: {s}"
        table, cols, vals, conflict, ret = m.groups()
        cols = [c.strip() for c in cols.split(",")]
        assert vals.count("%s") == len(cols) == len(params), s
        row = self.db.make_row(table, dict(zip(cols, params)))
        hit = self.db.clash(table, row)
        if hit:
            if conflict and hit == (conflict,):
                self._out, self.rowcount = [], 0
                return
            raise DbError("23505", f"{table} ซ้ำ {hit}")
        self.db.tables[table].append(row)
        self._out, self.rowcount = self._ret(table, ret, [row]), 1

    def _update(self, s, params):
        m = re.fullmatch(r"UPDATE (\w+) SET (.+?) WHERE (.+?)(?: RETURNING (.+))?", s)
        assert m, f"ฐานข้อมูลปลอมไม่รู้จัก SQL: {s}"
        table, sets, where, ret = m.groups()
        assign = {}
        for part in sets.split(","):
            mm = re.fullmatch(r"(\w+) = %s", part.strip())
            assert mm and mm.group(1) in self.db.schema[table]["cols"], part
            assign[mm.group(1)] = params.pop(0)
        pred = self._pred(table, where, params)
        hit = [r for r in self.db.tables[table] if pred(r)]
        for r in hit:
            new = {**r, **copy.deepcopy(assign)}
            for c, info in self.db.schema[table]["cols"].items():
                if new[c] is None and info["notnull"]:
                    raise DbError("23502", f"{table}.{c} ห้ามว่าง")
            if self.db.clash(table, new, skip=r):
                raise DbError("23505", f"{table} ซ้ำ")
            r.update(new)
        self._out, self.rowcount = self._ret(table, ret, hit), len(hit)

    def _delete(self, s, params):
        m = re.fullmatch(r"DELETE FROM (\w+) WHERE (.+)", s)
        assert m, f"ฐานข้อมูลปลอมไม่รู้จัก SQL: {s}"
        table, where = m.groups()
        pred = self._pred(table, where, params)
        gone = [r for r in self.db.tables[table] if pred(r)]
        self.db.remove(table, gone)
        self._out, self.rowcount = [], len(gone)


def _sess(role, dept, label):
    h = mock_api.wl_token_hash("tok")
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    return (h, 7 if role == "admin" else 8, role, dept, label, exp)


ADMIN = _sess("admin", None, "ผู้ดูแลระบบ")
HEAD = _sess("head", 2, "หัวหน้ากลุ่มสาระคณิตศาสตร์")
REQ = SimpleNamespace(headers={"authorization": "Bearer tok"})
NOREQ = SimpleNamespace(headers={})


def _call(db, sess, fn, *a, **kw):
    """เรียก route กับฐานข้อมูลปลอม · ยกข้อผิดพลาด = ย้อนทุกอย่างกลับเหมือนธุรกรรมที่ล้ม"""
    snap = copy.deepcopy((db.tables, db.seq))
    cur = FakeCur(db, sess)

    @contextlib.contextmanager
    def fake():
        yield cur
    saved = mock_api._wl_db
    mock_api._wl_db = fake
    try:
        return fn(*a, **kw)
    except Exception:
        db.tables, db.seq = snap
        raise
    finally:
        mock_api._wl_db = saved


def _code(fn):
    try:
        fn()
    except HTTPException as e:
        return e.status_code, e.detail
    return None, None


def _thai(text):
    return isinstance(text, str) and bool(re.search(r"[฀-๿]", text))


def _state(db):
    return copy.deepcopy(db.tables)


@contextlib.contextmanager
def _patched(**kw):
    saved = {k: getattr(mock_api, k) for k in kw}
    for k, v in kw.items():
        setattr(mock_api, k, v)
    try:
        yield
    finally:
        for k, v in saved.items():
            setattr(mock_api, k, v)


# ทะเบียนวิชาของเว็บนี้ (id ฝั่งเว็บ ≠ id ฝั่งตาราง) · ห้อง 1-12 = ม.1/1-ม.1/12 ในข้อมูลตั้งต้น
REGISTRY = [("ท21102", "ภาษาไทยพื้นฐาน 2", 1, False), ("ค21102", "คณิตศาสตร์พื้นฐาน 2", 2, False),
            ("ว21102", "วิทยาศาสตร์พื้นฐาน 2", 3, False), ("ก21902", "แนะแนว 2", 10, True),
            ("ศ21201", "ดนตรีสากล", 7, False), ("พ21201", "ฟุตบอล", 6, False)]


def _db():
    db = FakeDb()
    for i, (code, name, dept, act) in enumerate(REGISTRY):
        db.add("wl_subjects", sched_id=900 + i, code=code, name=name, department_id=dept, is_activity=act)
    return db


def _subj(db, code):
    return next(r for r in db.tables["wl_subjects"] if r["code"] == code)


def _term(db, year=2569, semester=2):
    """หลักสูตรหนึ่งชุดที่ admin สร้างผ่าน route: ห้อง ม.1/1-6 สามบรรทัด + ชุดคาบเสรีหนึ่งตัวเลือก"""
    c = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
              {"year": year, "semester": semester, "name": "ม.1/1-6", "group_ids": [1, 2, 3, 4, 5, 6]})
    lines = [_call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                   {"curriculum_id": c["id"], "code": code, "weekly": w, "credits": cr})
             for code, w, cr in (("ท21102", 3, 1.5), ("ค21102", 3, 1.5), ("ว21102", 2, 1))]
    s = _call(db, ADMIN, mock_api.wl_term_sets_create, REQ,
              {"year": year, "semester": semester, "kind": "elective", "name": "วิชาเสรี ม.1/1-6",
               "group_ids": [1, 2, 3, 4, 5, 6], "weekly": 2, "is_double": True})
    o = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ, {"set_id": s["id"], "code": "ศ21201"})
    return {"curriculum": c, "lines": lines, "set": s, "option": o}


# ── ฟังก์ชันล้วน: ช่วงห้อง · ระดับชั้น ────────────────────────────────────────
def test_room_range_uses_the_timetable_print_format():
    rr = mock_api.wl_room_range
    assert rr([f"ม.1/{i}" for i in range(1, 7)]) == "ม.1/1-6"
    assert rr(["ม.1/5", "ม.1/1", "ม.1/2", "ม.1/3"]) == "ม.1/1-3,5"
    assert rr(["ม.1/10", "ม.1/9"]) == "ม.1/9-10"                     # เรียงแบบเลข ไม่ใช่แบบตัวอักษร
    assert rr(["ม.1/7", "ม.1/8", "ม.1/10", "ม.1/11"]) == "ม.1/7-8,10-11"
    assert rr(["ม.2/1", "ม.1/1"]) == "ม.1/1 ม.2/1"
    assert rr(["ม.4/6ก", "ม.4/6ข"]) == "ม.4/6ก ม.4/6ข"                  # ห้องย่อยไม่หาย เขียนตามเดิม
    assert rr(["ม.4/6", "ม.4/6ก"]) == "ม.4/6 ม.4/6ก"
    assert rr([]) == "(ยังไม่มีห้อง)"


def test_level_comes_from_the_room_name():
    lv = mock_api.wl_level_of
    assert lv("ม.4/6ก") == "ม.4" and lv("ม.4/1 ก") == "ม.4" and lv("ม.1/10") == "ม.1"
    assert lv("ห้องพิเศษ") is None and lv(None) is None and lv("") is None


# ── ฟังก์ชันล้วน: wl_curricula_from_proposal ─────────────────────────────────
def _prow(gid, sid, code, weekly, **kw):
    """แถวรูปเดียวกับที่ wl_round_proposal คืน (มีครู — หลักสูตรต้องทิ้งครู)"""
    return {"department_id": kw.get("dept", 1), "group_id": gid, "subject_id": sid, "code": code,
            "name": kw.get("name", f"วิชา {code}"), "credits": kw.get("credits", 1.5), "weekly": weekly,
            "kind": kw.get("kind", "basic"), "teacher_id": kw.get("teacher", 103), "co_teacher_id": None,
            "lab_room_id": None, "is_double": False, "note": "", "confirmed": False, "from_plan": True,
            "flag": None}


G7 = {g: {"id": g, "name": f"ม.1/{g}"} for g in range(1, 8)}


def test_rooms_with_identical_lines_make_one_curriculum():
    base = [(501, "ท21102", 3), (502, "ค21102", 3)]
    rows = [_prow(g, sid, code, w) for g in range(1, 7) for sid, code, w in base]
    rows += [_prow(7, 501, "ท21102", 3), _prow(7, 503, "ค21202", 2, kind="additional")]
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, G7)
    assert [c["name"] for c in out["curricula"]] == ["ม.1/1-6", "ม.1/7"]
    first = out["curricula"][0]
    assert first["group_ids"] == [1, 2, 3, 4, 5, 6] and first["level"] == "ม.1"
    assert [ln["code"] for ln in first["lines"]] == ["ค21102", "ท21102"]          # เรียงตามรหัสวิชา
    assert first["lines"][0] == {"subject_id": 502, "code": "ค21102", "name": "วิชา ค21102", "credits": 1.5,
                                 "weekly": 3, "kind": "basic", "department_id": 1, "sort": 1}
    assert out["curricula"][1]["group_ids"] == [7]
    assert [ln["kind"] for ln in out["curricula"][1]["lines"]] == ["additional", "basic"]
    assert "teacher" not in json.dumps(out, ensure_ascii=False)


def test_same_subject_with_different_weekly_is_a_different_curriculum():
    rows = [_prow(1, 501, "ท21102", 3), _prow(2, 501, "ท21102", 2), _prow(3, 501, "ท21102", 3)]
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, G7)
    assert [(c["name"], c["group_ids"]) for c in out["curricula"]] == [("ม.1/1,3", [1, 3]), ("ม.1/2", [2])]


def test_rows_without_registry_subject_match_by_code():
    rows = [_prow(1, None, "X1", 2, dept=None), _prow(2, None, "X1", 2, dept=None), _prow(3, None, "X2", 2),
            _prow(None, 501, "ท21102", 3)]     # แถวไม่มีห้อง: wl_round_proposal รายงานไว้แล้ว ต้องไม่ทำให้ตั้งต้นล้ม
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, G7)
    assert [c["group_ids"] for c in out["curricula"]] == [[1, 2], [3]]
    assert out["curricula"][0]["lines"][0]["subject_id"] is None


def test_subroom_uses_its_level_and_name():
    groups = {80: {"id": 80, "name": "ม.4/6ก"}, 81: {"id": 81, "name": "ม.4/6ข"}, 5: {"id": 5, "name": "ม.2/1"}}
    rows = [_prow(80, 501, "ค31201", 2), _prow(81, 502, "ว31201", 2), _prow(5, 503, "ท22102", 3)]
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, groups)
    got = [(c["name"], c["level"]) for c in out["curricula"]]
    # เรียงตามระดับชั้นก่อน ม.2 มาก่อน ม.4 แม้ห้องย่อยอยู่ก่อนในรายการห้อง
    assert got == [("ม.2/1", "ม.2"), ("ม.4/6ก", "ม.4"), ("ม.4/6ข", "ม.4")], got


def test_same_subject_twice_in_one_room_keeps_both_lines():
    # แผนที่ขัดกันเอง (สองแถวไม่ชี้กัน) ยังเป็นการสอนสองแถว ห้ามยุบหายเงียบ ๆ
    rows = [_prow(1, 501, "ท21102", 3), _prow(1, 501, "ท21102", 3), _prow(2, 501, "ท21102", 3)]
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, G7)
    assert [(c["group_ids"], len(c["lines"])) for c in out["curricula"]] == [([1], 2), ([2], 1)]


def test_clashing_curriculum_names_get_a_number():
    groups = {1: {"id": 1, "name": "ม.1/1"}, 2: {"id": 2, "name": "ม.1/1"}}   # ชื่อห้องซ้ำในโปรแกรมจัดตาราง
    rows = [_prow(1, 501, "ท21102", 3), _prow(2, 502, "ค21102", 3)]
    out = mock_api.wl_curricula_from_proposal({"rows": rows, "sets": []}, groups)
    assert [c["name"] for c in out["curricula"]] == ["ม.1/1", "ม.1/1 (2)"]


def test_sets_keep_only_subjects_one_option_per_subject():
    def opt(sid, code, tid, room=None):
        return {"subject_id": sid, "code": code, "name": f"วิชา {code}", "department_id": 7, "teacher_id": tid,
                "room_id": room, "note": "", "confirmed": False, "from_plan": True}
    prop = {"rows": [], "sets": [
        {"kind": "elective", "name": "วิชาเสรี ม.1/7-12", "group_ids": [7, 8], "weekly": 2, "is_double": True,
         "options": [opt(601, "ศ21201", 103, 5), opt(601, "ศ21201", 104), opt(602, "พ21201", 105)]},
        {"kind": "activity", "name": "ลูกเสือ ม.1/1–ม.1/2 (2 ห้อง)", "group_ids": [1, 2], "weekly": 1,
         "is_double": False, "options": [opt(603, "ก21903", t) for t in (110, 111, 112)]}]}
    out = mock_api.wl_curricula_from_proposal(prop, G7)
    assert out["curricula"] == []
    assert out["sets"][0] == {"kind": "elective", "name": "วิชาเสรี ม.1/7-12", "group_ids": [7, 8], "weekly": 2,
                              "is_double": True,
                              "options": [{"subject_id": 601, "code": "ศ21201", "name": "วิชา ศ21201",
                                           "department_id": 7},
                                          {"subject_id": 602, "code": "พ21201", "name": "วิชา พ21201",
                                           "department_id": 7}]}
    # ครูคุมสามคนของกิจกรรมเดียว = ตัวเลือกเดียว (ครูหลายคนต่อตัวเลือกอยู่ในรอบ ไม่ใช่ในหลักสูตร)
    assert [o["subject_id"] for o in out["sets"][1]["options"]] == [603]
    assert "teacher" not in json.dumps(out) and "room_id" not in json.dumps(out)


def test_curricula_from_proposal_does_not_mutate_input():
    rows = [_prow(g, 501, "ท21102", 3) for g in (1, 2)]
    prop = {"rows": rows, "sets": [{"kind": "elective", "name": "x", "group_ids": [1], "weekly": 1,
                                    "is_double": False, "options": [{"subject_id": 601, "code": "a", "name": "b",
                                                                     "department_id": 1, "teacher_id": 3}]}],
            "unconverted": [], "counts": {}}
    p0, g0 = copy.deepcopy(prop), copy.deepcopy(G7)
    out = mock_api.wl_curricula_from_proposal(prop, G7)
    assert prop == p0 and G7 == g0
    out["curricula"][0]["group_ids"].append(99)
    out["curricula"][0]["lines"][0]["code"] = "เปลี่ยน"
    out["sets"][0]["group_ids"].append(99)
    out["sets"][0]["options"][0]["code"] = "เปลี่ยน"
    assert prop == p0


def _seed_src():
    data = json.loads((Path(mock_api.__file__).parent / "school_data.json").read_text(encoding="utf-8"))
    flat = []

    def walk(gs):
        for g in gs:
            flat.append(g)
            walk(g.get("children") or [])
    walk(data["groups"])
    src = {"requirements": data["requirements"], "pools": data["elective_pools"], "slots": [],
           "sched_subjects": {s["id"]: s for s in data["subjects"]}, "groups": {g["id"]: g for g in flat},
           "teacher_ids": {t["id"]: t["id"] + 1000 for t in data["teachers"]},
           "subject_ids": {s["id"]: s["id"] + 2000 for s in data["subjects"]},
           "subject_depts": {s["id"] + 2000: s.get("department_id") for s in data["subjects"]},
           "served": set()}
    return data, src


def _distinct_plans(requirements):
    by = collections.defaultdict(list)
    for r in requirements:
        by[r["group_id"]].append((r["subject_id"], r["weekly_count"]))
    return len({tuple(sorted(v)) for v in by.values()})


def test_seed_data_every_planned_room_is_in_exactly_one_curriculum():
    data, src = _seed_src()
    out = mock_api.wl_curricula_from_proposal(mock_api.wl_round_proposal(src), src["groups"])
    planned = {r["group_id"] for r in data["requirements"]}
    seen = collections.Counter(g for c in out["curricula"] for g in c["group_ids"])
    assert set(seen) == planned and set(seen.values()) == {1}
    assert sum(len(c["lines"]) * len(c["group_ids"]) for c in out["curricula"]) == 1220
    assert (sum(ln["weekly"] * len(c["group_ids"]) for c in out["curricula"] for ln in c["lines"])
            == sum(r["weekly_count"] for r in data["requirements"]))
    assert len(out["curricula"]) == _distinct_plans(data["requirements"]) == 74
    names = [c["name"] for c in out["curricula"]]
    assert len(set(names)) == len(names)
    assert out["curricula"][0]["name"] == "ม.1/1" and out["curricula"][0]["level"] == "ม.1"
    assert all(c["level"] for c in out["curricula"])
    assert len(out["sets"]) == 13 and sum(len(s["options"]) for s in out["sets"]) == 44


# ── ตัวประกอบข้อมูลจากโปรแกรมจัดตาราง ─────────────────────────────────────────
GLOBALS = ("REQUIREMENTS", "ELECTIVE_POOLS", "SLOTS", "SUBJECTS", "GROUPS", "TEACHERS", "DEPARTMENTS")


def test_timetable_source_maps_ids_and_never_touches_the_timetable_data():
    snaps = {k: copy.deepcopy(getattr(mock_api, k)) for k in GLOBALS}
    db = FakeDb()
    t = db.add("wl_teachers", sched_id=1, name="ครู")
    db.add("wl_teachers", sched_id=None, name="ครูพิมพ์เอง")
    s = db.add("wl_subjects", sched_id=1, code="ท22102", name="ไทย", department_id=4)
    db.add("wl_subjects", sched_id=None, code="X", name="พิมพ์เอง")
    src = mock_api._wl_timetable_source(FakeCur(db, None))
    assert src["teacher_ids"] == {1: t["id"]}
    assert src["subject_ids"] == {1: s["id"]} and src["subject_depts"] == {s["id"]: 4}
    assert len(src["requirements"]) == 1220 and len(src["pools"]) == 13 and len(src["groups"]) == 93
    assert src["served"] == set() and src["sched_subjects"][1]["code"] == "ท22102"
    # เป็นสำเนาลึก: แก้ src แล้วข้อมูลของโปรแกรมจัดตารางไม่เปลี่ยน
    src["requirements"][0]["teacher_id"] = -1
    src["pools"][0]["options"].clear()
    next(iter(src["groups"].values()))["name"] = "เปลี่ยน"
    src["sched_subjects"][1]["code"] = "เปลี่ยน"
    for k, v in snaps.items():
        assert getattr(mock_api, k) == v, k


# ── route: อ่าน ────────────────────────────────────────────────────────
def test_get_requires_year_and_semester_and_empty_term_is_empty():
    db = _db()
    for kw in ({}, {"year": "2569"}, {"semester": "2"}, {"year": "abc", "semester": "2"},
               {"year": "2569", "semester": "3"}, {"year": "1999", "semester": "1"}):
        for fn in (mock_api.wl_curricula_get, mock_api.wl_curricula_log):
            c, d = _code(lambda: _call(db, ADMIN, fn, REQ, **kw))
            assert c == 400 and _thai(d), (fn.__name__, kw, c, d)
    assert _call(db, HEAD, mock_api.wl_curricula_get, REQ, year="2569", semester="2") == {
        "curricula": [], "sets": [], "locked": False}
    for fn in (mock_api.wl_curricula_get, mock_api.wl_curricula_log):
        assert _code(lambda: _call(db, None, fn, NOREQ, year="2569", semester="2"))[0] == 401
    assert _code(lambda: _call(db, None, mock_api.wl_curricula_terms, NOREQ))[0] == 401


def test_head_can_read_curricula_and_log_of_all_departments():
    db = _db()
    _term(db)
    view = _call(db, HEAD, mock_api.wl_curricula_get, REQ, year="2569", semester="2")
    assert view["locked"] is False
    (c,) = view["curricula"]
    assert set(c) == {"id", "year", "semester", "name", "level", "note", "group_ids", "group_names", "lines"}
    assert c["group_names"] == [f"ม.1/{i}" for i in range(1, 7)] and c["level"] == "ม.1"
    # หัวหน้ากลุ่มสาระคณิตฯ (2) เห็นบรรทัดของกลุ่มอื่นด้วย — หลักสูตรเปิดให้ทุกคนดูทั้งโรงเรียน
    assert {ln["department_id"] for ln in c["lines"]} == {1, 2, 3}
    assert set(c["lines"][0]) == {"id", "curriculum_id", "subject_id", "code", "name", "credits", "weekly",
                                  "kind", "department_id", "sort"}
    assert [ln["credits"] for ln in c["lines"]] == [1.5, 1.5, 1]
    (s,) = view["sets"]
    assert set(s) == {"id", "year", "semester", "kind", "name", "group_ids", "group_names", "weekly",
                      "is_double", "options"}
    assert set(s["options"][0]) == {"id", "set_id", "subject_id", "code", "name", "department_id"}
    log = _call(db, HEAD, mock_api.wl_curricula_log, REQ, year="2569", semester="2")
    assert len(log) == 6 and set(log[0]) == {"id", "at", "by", "action", "detail"}
    assert [e["id"] for e in log] == sorted((e["id"] for e in log), reverse=True)     # ใหม่ก่อน
    assert log[0]["by"] == "ผู้ดูแลระบบ" and all(_thai(e["detail"]) for e in log)
    assert _call(db, HEAD, mock_api.wl_curricula_terms, REQ) == [
        {"year": 2569, "semester": 2, "label": "2/2569", "locked": False}]


def test_terms_are_listed_newest_first():
    db = _db()
    for y, s in ((2569, 1), (2570, 1), (2569, 2)):
        _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": y, "semester": s, "name": "ก"})
    _call(db, ADMIN, mock_api.wl_term_sets_create, REQ,
          {"year": 2568, "semester": 2, "kind": "activity", "name": "ลูกเสือ", "weekly": 1})
    db.add("wl_rounds", year=2569, semester=1, label="1/2569", status="closed")
    got = _call(db, HEAD, mock_api.wl_curricula_terms, REQ)
    assert [(t["year"], t["semester"], t["locked"]) for t in got] == [
        (2570, 1, False), (2569, 2, False), (2569, 1, True), (2568, 2, False)]


def test_log_is_newest_first_capped_at_500_and_per_term():
    db = _db()
    for i in range(510):
        db.tick += 1
        db.add("wl_curriculum_log", year=2569, semester=2, by_label="ผู้ดูแลระบบ", action="line.update",
               detail=f"แก้ครั้งที่ {i}")
    db.add("wl_curriculum_log", year=2569, semester=1, by_label="ผู้ดูแลระบบ", action="x", detail="ภาคอื่น")
    log = _call(db, HEAD, mock_api.wl_curricula_log, REQ, year="2569", semester="2")
    assert len(log) == 500 and log[0]["detail"] == "แก้ครั้งที่ 509" and log[-1]["detail"] == "แก้ครั้งที่ 10"
    assert isinstance(log[0]["at"], str)


# ── route: เขียน (admin เท่านั้น) ─────────────────────────────────────────
def _write_cases(t, year=2569, semester=2):
    cid, lid = t["curriculum"]["id"], t["lines"][0]["id"]
    sid, oid = t["set"]["id"], t["option"]["id"]
    m = mock_api
    # การลบอยู่ท้าย: ตัวทดสอบบันทึกรันทุกตัวต่อกันจริง ลบหลักสูตรก่อนจะทำให้ตัวถัดไปไม่มีอะไรให้แก้
    return [
        (m.wl_curricula_seed, (REQ, {"year": year, "semester": semester, "source": "timetable"}), {}),
        (m.wl_curricula_create, (REQ, {"year": year, "semester": semester, "name": "ใหม่", "group_ids": [7]}), {}),
        (m.wl_curricula_update, (cid, REQ), {"body": {"note": "แก้"}}),
        (m.wl_curriculum_lines_create, (REQ, {"curriculum_id": cid, "code": "ก21902", "weekly": 1}), {}),
        (m.wl_curriculum_lines_update, (lid, REQ), {"body": {"weekly": 4}}),
        (m.wl_term_sets_create, (REQ, {"year": year, "semester": semester, "kind": "activity",
                                       "name": "ลูกเสือ", "weekly": 1}), {}),
        (m.wl_term_sets_update, (sid, REQ), {"body": {"weekly": 3}}),
        (m.wl_term_set_options_create, (REQ, {"set_id": sid, "code": "พ21201"}), {}),
        (m.wl_term_set_options_delete, (oid, REQ), {}),
        (m.wl_curriculum_lines_delete, (lid, REQ), {}),
        (m.wl_term_sets_delete, (sid, REQ), {}),
        (m.wl_curricula_delete, (cid, REQ), {}),
    ]


def test_head_cannot_write_any_curriculum_route():
    db = _db()
    t = _term(db)
    before = _state(db)
    cases = _write_cases(t)
    assert len(cases) == 12
    for fn, args, kw in cases:
        c, d = _code(lambda: _call(db, HEAD, fn, *args, **kw))
        assert c == 403 and _thai(d), (fn.__name__, c, d)
        assert _state(db) == before, fn.__name__
        anon = tuple(NOREQ if a is REQ else a for a in args)
        c, _ = _code(lambda: _call(db, None, fn, *anon, **kw))
        assert c == 401, (fn.__name__, c)


def test_every_write_logs_one_thai_entry():
    db = _db()
    t = _term(db)
    assert db.count("wl_curriculum_log") == 6        # สร้างหลักสูตร + 3 บรรทัด + ชุด + ตัวเลือก
    entries = sorted(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert entries[1]["detail"] == "เพิ่ม ท21102 ภาษาไทยพื้นฐาน 2 (3 คาบ) ในหลักสูตร ม.1/1-6"
    assert all(e["by_label"] == "ผู้ดูแลระบบ" and e["year"] == 2569 and e["semester"] == 2 for e in entries)
    # ทุก route เขียนที่เหลือ (ยกเว้นการตั้งต้นซึ่งต้องการภาคเรียนว่าง ตรวจในตัวทดสอบของมันเอง)
    for fn, args, kw in _write_cases(t)[1:]:
        n = db.count("wl_curriculum_log")
        _call(db, ADMIN, fn, *args, **kw)
        assert db.count("wl_curriculum_log") == n + 1, fn.__name__
        last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
        assert _thai(last["detail"]) and last["by_label"] == "ผู้ดูแลระบบ", (fn.__name__, last)
        assert (last["year"], last["semester"]) == (2569, 2), fn.__name__
    details = [r["detail"] for r in sorted(db.tables["wl_curriculum_log"], key=lambda r: r["id"])][6:]
    assert len(details) == 11
    assert details[0] == "สร้างหลักสูตร ใหม่ (ห้อง ม.1/7)", details[0]
    assert details[1] == "แก้หลักสูตร ม.1/1-6: หมายเหตุ (ว่าง) → แก้", details[1]
    assert details[2] == "เพิ่ม ก21902 แนะแนว 2 (1 คาบ) ในหลักสูตร ม.1/1-6", details[2]
    assert details[3] == "แก้ ท21102 ภาษาไทยพื้นฐาน 2 ในหลักสูตร ม.1/1-6: คาบ/สัปดาห์ 3 → 4", details[3]
    assert details[-1].startswith("ลบหลักสูตร ม.1/1-6"), details[-1]


def test_line_update_and_delete_log_texts():
    db = _db()
    t = _term(db)
    lid = t["lines"][0]["id"]
    _call(db, ADMIN, mock_api.wl_curriculum_lines_update, lid, REQ, body={"weekly": 2, "credits": 1})
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert last["detail"] == "แก้ ท21102 ภาษาไทยพื้นฐาน 2 ในหลักสูตร ม.1/1-6: หน่วยกิต 1.5 → 1 · คาบ/สัปดาห์ 3 → 2", last
    _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, lid, REQ)
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert last["detail"] == "ลบ ท21102 ภาษาไทยพื้นฐาน 2 (2 คาบ) ออกจากหลักสูตร ม.1/1-6", last


def test_locked_term_refuses_every_write():
    db = _db()
    t = _term(db)
    db.add("wl_rounds", year=2569, semester=2, label="2/2569", status="closed")
    before = _state(db)
    for fn, args, kw in _write_cases(t):
        c, d = _code(lambda: _call(db, ADMIN, fn, *args, **kw))
        assert c == 409 and _thai(d) and "ปิด" in d, (fn.__name__, c, d)
        assert _state(db) == before, fn.__name__
    assert _call(db, HEAD, mock_api.wl_curricula_get, REQ, year="2569", semester="2")["locked"] is True
    # ภาคเรียนที่รอบยังไม่ปิดแก้ได้ตามปกติ
    db.add("wl_rounds", year=2570, semester=1, label="1/2570", status="filling")
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "ม.1/1"})


def test_group_in_two_curricula_same_term_is_409():
    db = _db()
    a = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
              {"year": 2569, "semester": 2, "name": "ม.1/1-2", "group_ids": [1, 2]})
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
                               {"year": 2569, "semester": 2, "name": "ม.1/2-3", "group_ids": [2, 3]}))
    assert c == 409 and "ม.1/2" in d and "ม.1/1-2" in d, (c, d)
    assert _state(db) == before
    b = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
              {"year": 2569, "semester": 2, "name": "ม.1/3", "group_ids": [3]})
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_update, b["id"], REQ,
                               body={"group_ids": [3, 1]}))
    assert c == 409 and "ม.1/1-2" in d, (c, d)
    assert _state(db) == before
    # ภาคเรียนอื่นใช้ห้องเดียวกันได้ · ย้ายห้องได้เมื่อเอาออกจากหลักสูตรเดิมก่อน
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2570, "semester": 1, "name": "x", "group_ids": [1]})
    _call(db, ADMIN, mock_api.wl_curricula_update, a["id"], REQ, body={"group_ids": [2]})
    got = _call(db, ADMIN, mock_api.wl_curricula_update, b["id"], REQ, body={"group_ids": [3, 1]})
    assert got["group_ids"] == [1, 3] and got["group_names"] == ["ม.1/1", "ม.1/3"]


def test_curriculum_checks_names_and_groups():
    db = _db()
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2569, "semester": 2, "name": "ม.1 ห้องปกติ"})
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
                               {"year": 2569, "semester": 2, "name": " ม.1 ห้องปกติ "}))
    assert c == 409 and _thai(d)
    for bad in ({"year": 2569, "semester": 2, "name": "x", "group_ids": [999999]},     # ไม่มีห้องนี้
                {"year": 2569, "semester": 2, "name": "x", "group_ids": "1"},
                {"year": 2569, "semester": 2, "name": "x", "group_ids": [True]},
                {"year": 2569, "semester": 2, "name": " "},
                {"year": 2569, "semester": 2, "name": "x", "teacher_id": 3},
                {"year": 2569, "semester": 5, "name": "x"}):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_create, REQ, bad))
        assert c == 400 and _thai(d), (bad, c, d)
    got = _call(db, ADMIN, mock_api.wl_curricula_create, REQ,
                {"year": 2569, "semester": 2, "name": "ม.4/6", "group_ids": [46, 79], "note": "ห้องเรียนพิเศษ"})
    assert got["level"] == "ม.4" and got["group_names"] == ["ม.4/6", "ม.4/6ก"] and got["lines"] == []
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_update, 9999, REQ, body={"note": "x"}))[0] == 404
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_update, got["id"], REQ, body={}))[0] == 400


def test_line_code_matching_registry_binds_subject_name_and_department():
    db = _db()
    c = _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2569, "semester": 2, "name": "ม.1/1-6"})
    ln = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
               {"curriculum_id": c["id"], "code": "  ท21102 ", "weekly": 3})
    assert ln == {"id": ln["id"], "curriculum_id": c["id"], "subject_id": _subj(db, "ท21102")["id"],
                  "code": "ท21102", "name": "ภาษาไทยพื้นฐาน 2", "credits": None, "weekly": 3, "kind": "basic",
                  "department_id": 1, "sort": 1}
    act = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                {"curriculum_id": c["id"], "code": "ก21902", "weekly": 1})
    assert act["kind"] == "activity" and act["department_id"] == 10 and act["sort"] == 2
    # รหัสที่ไม่มีในทะเบียน: ต้องพิมพ์ชื่อเอง ไม่ผูกวิชา ประเภทเดาจากรหัส
    c400, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                                  {"curriculum_id": c["id"], "code": "ค21202", "weekly": 2}))
    assert c400 == 400 and _thai(d)
    free = _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                 {"curriculum_id": c["id"], "code": "ค21202", "name": "คณิตศาสตร์เพิ่มเติม 2", "weekly": 2,
                  "credits": 1, "sort": 9})
    assert (free["subject_id"], free["department_id"], free["kind"], free["sort"]) == (None, None, "additional", 9)
    # แก้รหัสเป็นรหัสในทะเบียน → ผูกวิชาและเติมชื่อ/กลุ่มสาระ
    got = _call(db, ADMIN, mock_api.wl_curriculum_lines_update, free["id"], REQ, body={"code": "ว21102"})
    assert (got["subject_id"], got["name"], got["department_id"]) == (_subj(db, "ว21102")["id"],
                                                                      "วิทยาศาสตร์พื้นฐาน 2", 3)
    # แก้เป็นรหัสที่ไม่มีในทะเบียน: ชื่อเดิมเป็นของวิชาอื่นแล้ว ต้องพิมพ์ชื่อใหม่มาด้วย ไม่ปล่อยชื่อค้าง
    c400, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, free["id"], REQ,
                                  body={"code": "ว21299"}))
    assert c400 == 400 and "ว21299" in d, (c400, d)
    got = _call(db, ADMIN, mock_api.wl_curriculum_lines_update, free["id"], REQ,
                body={"code": "ว21299", "name": "วิทยาศาสตร์เพิ่มเติม"})
    assert (got["subject_id"], got["name"]) == (None, "วิทยาศาสตร์เพิ่มเติม")
    # ส่งรหัสเดิมซ้ำมาพร้อมช่องอื่น (ฟอร์มส่งทั้งแถว) ไม่ต้องพิมพ์ชื่อใหม่
    assert _call(db, ADMIN, mock_api.wl_curriculum_lines_update, free["id"], REQ,
                 body={"code": "ว21299", "weekly": 3})["weekly"] == 3
    # รหัสซ้ำกันในทะเบียน (ข้อมูลเก่าที่ยังไม่ได้แก้) ผูกไม่ได้ ต้องบอก ไม่เดา
    db.add("wl_subjects", sched_id=None, code="ศ21201", name="ดนตรีสากล (ซ้ำ)")
    c409, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                                  {"curriculum_id": c["id"], "code": "ศ21201", "weekly": 1}))
    assert c409 == 409 and "ศ21201" in d
    # ตัวเลือกของชุดผูกด้วยกฎเดียวกัน · วิชาเดียวกันสองตัวเลือกในชุดเดียวไม่ได้
    s = _call(db, ADMIN, mock_api.wl_term_sets_create, REQ,
              {"year": 2569, "semester": 2, "kind": "elective", "name": "เสรี", "weekly": 1})
    o = _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ, {"set_id": s["id"], "code": "พ21201"})
    assert o == {"id": o["id"], "set_id": s["id"], "subject_id": _subj(db, "พ21201")["id"], "code": "พ21201",
                 "name": "ฟุตบอล", "department_id": 6}
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_term_set_options_create, REQ,
                               {"set_id": s["id"], "code": "พ21201"}))[0] == 409


def test_line_values_are_checked():
    db = _db()
    c = _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2569, "semester": 2, "name": "x"})
    base = {"curriculum_id": c["id"], "code": "ท21102", "weekly": 3}
    for bad in ({**base, "weekly": -1}, {**base, "weekly": 1.5}, {**base, "weekly": True}, {"curriculum_id": c["id"],
                "code": "ท21102"}, {**base, "credits": -1}, {**base, "credits": "1"}, {**base, "credits": True},
                {**base, "credits": float("inf")}, {**base, "kind": "x"}, {**base, "department_id": 999},
                {**base, "code": ""}, {**base, "curriculum_id": "1"}, {**base, "teacher_id": 1}):
        code, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ, bad))
        assert code == 400 and _thai(d), (bad, code, d)
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
                               {**base, "curriculum_id": 9999}))[0] == 404
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_update, 9999, REQ,
                               body={"weekly": 1}))[0] == 404


def test_delete_curriculum_removes_its_lines_and_groups():
    db = _db()
    t = _term(db)
    _call(db, ADMIN, mock_api.wl_curricula_delete, t["curriculum"]["id"], REQ)
    assert db.count("wl_curricula") == 0 and db.count("wl_curriculum_lines") == 0
    assert db.count("wl_curriculum_groups") == 0
    _call(db, ADMIN, mock_api.wl_term_sets_delete, t["set"]["id"], REQ)
    assert db.count("wl_term_sets") == 0 and db.count("wl_term_set_options") == 0
    last = max(db.tables["wl_curriculum_log"], key=lambda r: r["id"])
    assert last["detail"].startswith("ลบชุดคาบเสรี วิชาเสรี ม.1/1-6"), last


def test_removing_routes_pass_force_to_the_hook():
    db = _db()
    t = _term(db)
    calls = []
    with _patched(_wl_after_curriculum_change=lambda cur, y, s, force: calls.append((y, s, force))):
        _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][0]["id"], REQ, body={"force": True})
        _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][1]["id"], REQ, force="1")
        _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][2]["id"], REQ)
        _call(db, ADMIN, mock_api.wl_curricula_update, t["curriculum"]["id"], REQ,
              body={"group_ids": [1, 2], "force": True})
        _call(db, ADMIN, mock_api.wl_term_sets_update, t["set"]["id"], REQ, force="true", body={"group_ids": [1]})
        _call(db, ADMIN, mock_api.wl_term_set_options_delete, t["option"]["id"], REQ, force="1")
        _call(db, ADMIN, mock_api.wl_term_sets_delete, t["set"]["id"], REQ)
        _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
              {"curriculum_id": t["curriculum"]["id"], "code": "ท21102", "weekly": 3})
        _call(db, ADMIN, mock_api.wl_curricula_delete, t["curriculum"]["id"], REQ, force="1")
        assert _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_delete, 1, REQ, body={"force": "yes"}))[0] == 400
    assert calls == [(2569, 2, True), (2569, 2, True), (2569, 2, False), (2569, 2, True), (2569, 2, True),
                     (2569, 2, True), (2569, 2, False), (2569, 2, False), (2569, 2, True)], calls


def test_hook_refusal_rolls_back_the_removal():
    # Task 3 เติม hook ให้ยก 409 เมื่อแถวที่จะหายมีครู — การลบต้องไม่เกิดขึ้น และไม่มีบันทึก
    db = _db()
    t = _term(db)
    before = _state(db)

    def refuse(cur, y, s, force):
        if not force:
            raise HTTPException(409, "มีครูใส่ไว้แล้ว 3 แถว")
    with _patched(_wl_after_curriculum_change=refuse):
        c, _ = _code(lambda: _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][0]["id"], REQ))
        assert c == 409 and _state(db) == before
        _call(db, ADMIN, mock_api.wl_curriculum_lines_delete, t["lines"][0]["id"], REQ, force="1")
    assert db.count("wl_curriculum_lines") == 2


# ── การตั้งต้น ─────────────────────────────────────────────────────────
def _lines_times_groups(db, year, semester):
    cids = {c["id"] for c in db.tables["wl_curricula"] if (c["year"], c["semester"]) == (year, semester)}
    groups = collections.Counter(g["curriculum_id"] for g in db.tables["wl_curriculum_groups"])
    return sum(groups[ln["curriculum_id"]] for ln in db.tables["wl_curriculum_lines"] if ln["curriculum_id"] in cids)


def test_seed_from_timetable_twice_is_409():
    db = FakeDb()
    snaps = {k: copy.deepcopy(getattr(mock_api, k)) for k in GLOBALS}
    out = _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
    assert out["counts"] == {"curricula": 74, "lines": out["counts"]["lines"], "groups": 93, "sets": 13,
                             "options": 44}, out["counts"]
    assert out["imported"]["teachers"]["created"] == 143 and out["imported"]["subjects"]["created"] == 271
    assert out["unconverted"] == [] and out["label"] == "2/2569"
    assert _lines_times_groups(db, 2569, 2) == 1220
    assert db.count("wl_curriculum_lines") == out["counts"]["lines"]
    # ทุกบรรทัดผูกวิชาในทะเบียนและมีกลุ่มสาระ (ดึงวิชามาก่อนแปลง)
    assert all(ln["subject_id"] is not None and ln["department_id"] is not None
               for ln in db.tables["wl_curriculum_lines"])
    (entry,) = db.tables["wl_curriculum_log"]
    assert entry["action"] == "seed.timetable" and _thai(entry["detail"]) and "74 หลักสูตร" in entry["detail"]
    view = _call(db, HEAD, mock_api.wl_curricula_get, REQ, year="2569", semester="2")
    assert view["curricula"][0]["name"] == "ม.1/1" and len(view["sets"]) == 13
    before = _state(db)
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_seed, REQ,
                               {"year": 2569, "semester": 2, "source": "timetable"}))
    assert c == 409 and _thai(d) and _state(db) == before
    for k, v in snaps.items():
        assert getattr(mock_api, k) == v, k


def test_seed_binds_lines_by_code_when_a_timetable_subject_clashed_with_a_typed_one():
    # วิชาที่พิมพ์เองไว้ก่อนด้วยรหัสเดียวกับวิชาฝั่งตาราง: ดึงวิชาฝั่งตารางไม่ได้ (รหัสห้ามซ้ำ) แผนของวิชานั้นจึง
    # แปลงเป็นวิชาในทะเบียนไม่ได้ — บรรทัดหลักสูตรต้องยังผูกกับวิชาที่มีรหัสนั้นในทะเบียน ไม่ใช่ลอยไม่มีวิชา
    db = FakeDb()
    typed = db.add("wl_subjects", sched_id=None, code="ท22102", name="ไทย ม.2 (พิมพ์เอง)", department_id=1)
    out = _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 2, "source": "timetable"})
    assert out["imported"]["subjects"] == {"created": 270, "linked": 0, "skipped": 1}, out["imported"]
    assert out["unconverted"] and all(_thai(u["reason"]) for u in out["unconverted"])
    hit = [ln for ln in db.tables["wl_curriculum_lines"] if ln["code"] == "ท22102"]
    assert hit and all(ln["subject_id"] == typed["id"] and ln["department_id"] == 1 for ln in hit), hit[:2]
    assert all(ln["subject_id"] is not None for ln in db.tables["wl_curriculum_lines"])
    assert _lines_times_groups(db, 2569, 2) == 1220
    entry = db.tables["wl_curriculum_log"][0]
    assert f"แปลงไม่ได้ {len(out['unconverted'])} รายการ" in entry["detail"], entry["detail"]


def _norm(view):
    cs = [{"name": c["name"], "level": c["level"], "note": c["note"], "group_ids": c["group_ids"],
           "group_names": c["group_names"],
           "lines": [{k: ln[k] for k in ("subject_id", "code", "name", "credits", "weekly", "kind", "department_id",
                                         "sort")} for ln in c["lines"]]} for c in view["curricula"]]
    ss = [{"kind": s["kind"], "name": s["name"], "group_ids": s["group_ids"], "weekly": s["weekly"],
           "is_double": s["is_double"],
           "options": [{k: o[k] for k in ("subject_id", "code", "name", "department_id")} for o in s["options"]]}
          for s in view["sets"]]
    return cs, ss


def test_seed_copy_from_previous_term_copies_lines_groups_sets():
    db = FakeDb()
    _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, {"year": 2569, "semester": 1, "source": "timetable"})
    first = _call(db, ADMIN, mock_api.wl_curricula_get, REQ, year="2569", semester="1")
    cid = first["curricula"][0]["id"]
    _call(db, ADMIN, mock_api.wl_curricula_update, cid, REQ, body={"note": "หมายเหตุเทอมก่อน"})
    _call(db, ADMIN, mock_api.wl_curriculum_lines_create, REQ,
          {"curriculum_id": cid, "code": "Z99999", "name": "วิชาพิมพ์เอง", "weekly": 1, "credits": 0.5})
    log1 = db.count("wl_curriculum_log", year=2569, semester=1)
    out = _call(db, ADMIN, mock_api.wl_curricula_seed, REQ,
                {"year": 2569, "semester": 2, "source": "copy", "from_year": 2569, "from_semester": 1})
    a = _call(db, ADMIN, mock_api.wl_curricula_get, REQ, year="2569", semester="1")
    b = _call(db, ADMIN, mock_api.wl_curricula_get, REQ, year="2569", semester="2")
    assert _norm(a) == _norm(b)
    assert len(b["curricula"]) == 74 and len(b["sets"]) == 13
    assert {c["id"] for c in a["curricula"]}.isdisjoint({c["id"] for c in b["curricula"]})
    assert all((c["year"], c["semester"]) == (2569, 2) for c in b["curricula"] + b["sets"])
    assert out["counts"]["lines"] == sum(len(c["lines"]) for c in a["curricula"])
    assert out["imported"] is None and out["unconverted"] == []
    assert db.count("wl_curriculum_log", year=2569, semester=1) == log1
    (entry,) = [r for r in db.tables["wl_curriculum_log"] if (r["year"], r["semester"]) == (2569, 2)]
    assert entry["action"] == "seed.copy" and "1/2569" in entry["detail"]
    # ภาคเรียนปลายทางมีแล้ว 409 · ต้นทางว่าง 404 · ต้นทางเดียวกับปลายทาง 400 · ไม่บอกต้นทาง 400
    body = {"year": 2569, "semester": 2, "source": "copy", "from_year": 2569, "from_semester": 1}
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, body))[0] == 409
    for bad, want in (({**body, "year": 2570, "semester": 1, "from_year": 2568}, 404),
                      ({**body, "year": 2570, "semester": 1, "from_year": 2570}, 400),
                      ({"year": 2570, "semester": 1, "source": "copy"}, 400),
                      ({"year": 2570, "semester": 1, "source": "other"}, 400)):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_seed, REQ, bad))
        assert c == want and _thai(d), (bad, c, d)


def test_seed_refuses_when_write_blocked():
    db = FakeDb()
    with _patched(_db_write_blocked=lambda: True):
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_curricula_seed, REQ,
                                   {"year": 2569, "semester": 2, "source": "timetable"}))
        assert c == 503 and _thai(d), (c, d)
        assert all(rows == [] for rows in db.tables.values())
    # คัดลอกอ่านแต่ตารางของเว็บนี้ จึงไม่ติดด่านนี้
    _call(db, ADMIN, mock_api.wl_curricula_create, REQ, {"year": 2569, "semester": 1, "name": "ม.1/1",
                                                        "group_ids": [1]})
    with _patched(_db_write_blocked=lambda: True):
        out = _call(db, ADMIN, mock_api.wl_curricula_seed, REQ,
                    {"year": 2569, "semester": 2, "source": "copy", "from_year": 2569, "from_semester": 1})
    assert out["counts"]["curricula"] == 1


# ── ทะเบียนวิชา: รหัสห้ามซ้ำ · การดึงวิชา ─────────────────────────────────────
def test_duplicate_subject_code_is_409_on_create_and_rename():
    db = _db()
    _call(db, ADMIN, mock_api.wl_subjects_update, _subj(db, "ค21102")["id"], REQ, {"active": False})
    for code in ("ท21102", " ท21102 ", "ค21102"):           # ตัดช่องว่าง · รวมวิชาที่ไม่เปิดสอนแล้ว
        c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_subjects_create, REQ, {"code": code, "name": "ซ้ำ"}))
        assert c == 409 and code.strip() in d and _thai(d), (code, c, d)
    new = _call(db, ADMIN, mock_api.wl_subjects_create, REQ, {"code": "ส21102", "name": "สังคมศึกษา 2"})
    c, d = _code(lambda: _call(db, ADMIN, mock_api.wl_subjects_update, new["id"], REQ, {"code": "ว21102"}))
    assert c == 409 and "ว21102" in d
    # รหัสเดิมของตัวเอง · แก้ช่องอื่น · รหัสใหม่ที่ไม่ซ้ำ ผ่าน
    _call(db, ADMIN, mock_api.wl_subjects_update, new["id"], REQ, {"code": "ส21102", "name": "สังคม 2"})
    _call(db, ADMIN, mock_api.wl_subjects_update, new["id"], REQ, {"active": False})
    assert _call(db, ADMIN, mock_api.wl_subjects_update, new["id"], REQ, {"code": "ส21104"})["code"] == "ส21104"
    # รหัสซ้ำค้างมาจากขั้นที่ 1: ส่งรหัสเดิมของตัวเองซ้ำ (เช่น ปิดวิชาที่ซ้ำ) ไม่ได้สร้างรหัสซ้ำใหม่ ต้องผ่าน
    a = db.add("wl_subjects", sched_id=None, code="DUP1", name="ซ้ำ ก")
    db.add("wl_subjects", sched_id=None, code="DUP1 ", name="ซ้ำ ข")
    got = _call(db, ADMIN, mock_api.wl_subjects_update, a["id"], REQ, {"code": "DUP1", "active": False})
    assert got["active"] is False
    assert _code(lambda: _call(db, ADMIN, mock_api.wl_subjects_update, new["id"], REQ, {"code": "DUP1"}))[0] == 409


def test_subject_import_skips_code_clash_with_other_sched_id():
    db = FakeDb()
    db.add("wl_subjects", sched_id=None, code="MA1", name="คณิตพิมพ์เอง")
    db.add("wl_subjects", sched_id=7, code="SC1", name="วิทย์")
    sched = [{"id": 5, "code": " MA1", "name": "คณิต"},          # ชนกับวิชาพิมพ์เอง → ไม่สร้าง
             {"id": 6, "code": "EN1", "name": "อังกฤษ"},
             {"id": 7, "code": "SC1", "name": "วิทย์"},          # sched_id เดียวกัน = ผูกแล้ว ไม่ใช่ชน
             {"id": 8, "code": "SC1", "name": "วิทย์อีกตัว"}]   # ชนกับวิชาที่ผูก sched_id อื่น
    snap = copy.deepcopy(sched)
    with _patched(SUBJECTS=sched):
        before = _state(db)
        prev = _call(db, ADMIN, mock_api.wl_subjects_import_preview, REQ)
        assert _state(db) == before
        out = _call(db, ADMIN, mock_api.wl_subjects_import, REQ)
    assert prev == out == {"created": 1, "linked": 1, "skipped": 2}, (prev, out)
    assert sorted(r["code"] for r in db.tables["wl_subjects"]) == ["EN1", "MA1", "SC1"]
    assert sched == snap


def _run_import(kind, fn_route, source, as_route):
    db = FakeDb()
    db.add("wl_teachers", sched_id=1, name="ครูเดิม")
    db.add("wl_subjects", sched_id=1, code="A1", name="เดิม")
    if as_route:
        out = _call(db, ADMIN, fn_route, REQ)
        log = None
    else:
        cur = FakeCur(db, None)                      # ไม่มี session เลย: ตัวกลางไม่ตรวจสิทธิ์
        out = mock_api._wl_import_rows(cur, kind, source, True)
        log = cur.log
    return out, db.tables, log


def test_import_routes_unchanged_after_split():
    teachers = [{"id": 1, "name": "ครูเดิม"}, {"id": 2, "name": "ใหม่", "code": "T2", "department_id": 3},
                {"name": "ไม่มีรหัส"}]
    subjects = [{"id": 1, "code": "A1", "name": "เดิม"}, {"id": 2, "code": "B2", "name": "ใหม่"}]
    with _patched(TEACHERS=teachers, SUBJECTS=subjects):
        for kind, route in (("teachers", mock_api.wl_teachers_import), ("subjects", mock_api.wl_subjects_import)):
            src = teachers if kind == "teachers" else subjects
            r_out, r_tables, _ = _run_import(kind, route, src, True)
            d_out, d_tables, log = _run_import(kind, route, src, False)
            assert r_out == d_out and r_tables == d_tables, kind
            assert all("wl_sessions" not in s for s, _ in log), kind
        assert _run_import("teachers", None, teachers, False)[0] == {"created": 1, "linked": 1, "skipped": 1}
        # ด่านยังอยู่ที่ route: ข้อมูลโรงเรียนยังไม่โหลด → 503 · หัวหน้า → 403
        with _patched(_db_write_blocked=lambda: True):
            for fn in (mock_api.wl_teachers_import, mock_api.wl_subjects_import_preview):
                assert _code(lambda: _call(FakeDb(), ADMIN, fn, REQ))[0] == 503
            assert _run_import("subjects", None, subjects, False)[0]["created"] == 1   # ตัวกลางไม่ตรวจด่าน
        assert _code(lambda: _call(FakeDb(), HEAD, mock_api.wl_teachers_import, REQ))[0] == 403


# ── ตาราง SQL ───────────────────────────────────────────────────────────
def _cols(table):
    body = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", mock_api._WL_SCHEMA, re.S).group(1)
    return {ln.split()[0] for ln in body.strip().splitlines()
            if ln.strip() and not ln.strip().upper().startswith(("UNIQUE", "CHECK", "PRIMARY"))}


def _table(table):
    return re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);", mock_api._WL_SCHEMA, re.S).group(1)


def test_schema_round_rows_reference_curriculum_lines():
    sql = mock_api._WL_SCHEMA
    assert _cols("wl_rows") == {"id", "round_id", "line_id", "group_id", "teacher_id", "co_teacher_id",
                                "lab_room_id", "is_double", "note", "confirmed", "from_plan", "flag"}
    assert "code" not in _cols("wl_rows") and "weekly" not in _cols("wl_rows")
    assert re.search(r"line_id\s+bigint NOT NULL REFERENCES wl_curriculum_lines\(id\)", _table("wl_rows"))
    assert "UNIQUE (round_id, line_id, group_id)" in _table("wl_rows")
    assert _cols("wl_option_teachers") == {"id", "round_id", "option_id", "teacher_id", "room_id", "note",
                                           "confirmed", "from_plan"}
    assert re.search(r"option_id\s+bigint NOT NULL REFERENCES wl_term_set_options\(id\)",
                     _table("wl_option_teachers"))
    for gone in ("wl_sets", "wl_set_options"):
        assert not re.search(rf"CREATE TABLE IF NOT EXISTS {gone}\b", sql), gone
    assert _cols("wl_curricula") == {"id", "year", "semester", "name", "level", "note"}
    assert "UNIQUE (year, semester, name)" in _table("wl_curricula")
    assert _cols("wl_curriculum_lines") == {"id", "curriculum_id", "subject_id", "code", "name", "credits",
                                            "weekly", "kind", "department_id", "sort"}
    lines = _table("wl_curriculum_lines")
    assert re.search(r"curriculum_id\s+bigint NOT NULL REFERENCES wl_curricula\(id\) ON DELETE CASCADE", lines)
    assert re.search(r"subject_id\s+bigint REFERENCES wl_subjects\(id\)", lines)
    assert re.search(r"weekly\s+integer NOT NULL CHECK \(weekly >= 0\)", lines)
    assert re.search(r"credits\s+numeric", lines)
    assert _cols("wl_curriculum_groups") == {"curriculum_id", "year", "semester", "group_id"}
    assert "PRIMARY KEY (year, semester, group_id)" in _table("wl_curriculum_groups")
    assert "ON DELETE CASCADE" in _table("wl_curriculum_groups")
    assert _cols("wl_term_sets") == {"id", "year", "semester", "kind", "name", "group_ids", "weekly", "is_double"}
    assert re.search(r"group_ids\s+integer\[\]", _table("wl_term_sets"))
    assert _cols("wl_term_set_options") == {"id", "set_id", "subject_id", "code", "name", "department_id"}
    assert re.search(r"set_id\s+bigint NOT NULL REFERENCES wl_term_sets\(id\) ON DELETE CASCADE",
                     _table("wl_term_set_options"))
    assert _cols("wl_curriculum_log") == {"id", "year", "semester", "at", "by_label", "action", "detail"}
    # ไม่มีดัชนี unique ใหม่บนตารางที่มีข้อมูลจริง · ไม่ ALTER ตารางเดิม · ทุกคำสั่งรันซ้ำได้
    uniq = re.findall(r"CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)", sql, re.I)
    assert {n for n, t in uniq if t in ("wl_codes", "wl_teachers", "wl_subjects")} == {
        "wl_codes_one_admin", "wl_codes_one_per_dept"}
    assert not re.search(r"ALTER\s+TABLE", sql, re.I)
    for stmt in re.findall(r"CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+(\S+)", sql, re.I):
        assert stmt.upper() == "IF", stmt
    # ลำดับ: ตารางที่ถูกอ้างต้องสร้างก่อนตารางที่อ้างมัน
    pos = {t: sql.index(f"CREATE TABLE IF NOT EXISTS {t} ") for t in
           ("wl_subjects", "wl_curricula", "wl_curriculum_lines", "wl_term_sets", "wl_term_set_options",
            "wl_rounds", "wl_rows", "wl_option_teachers")}
    assert pos["wl_subjects"] < pos["wl_curricula"] < pos["wl_curriculum_lines"] < pos["wl_rows"]
    assert pos["wl_term_sets"] < pos["wl_term_set_options"] < pos["wl_option_teachers"]
    assert pos["wl_rounds"] < pos["wl_rows"]


def test_curriculum_routes_are_registered():
    paths = {(v, p) for v, p, _ in mock_api.app.routes}
    for want in (("get", "/api/workload/curricula"), ("get", "/api/workload/curricula/terms"),
                 ("get", "/api/workload/curricula/log"), ("post", "/api/workload/curricula/seed"),
                 ("post", "/api/workload/curricula"), ("put", "/api/workload/curricula/{curriculum_id}"),
                 ("delete", "/api/workload/curricula/{curriculum_id}"),
                 ("post", "/api/workload/curriculum-lines"), ("put", "/api/workload/curriculum-lines/{line_id}"),
                 ("delete", "/api/workload/curriculum-lines/{line_id}"),
                 ("post", "/api/workload/term-sets"), ("put", "/api/workload/term-sets/{set_id}"),
                 ("delete", "/api/workload/term-sets/{set_id}"),
                 ("post", "/api/workload/term-set-options"),
                 ("delete", "/api/workload/term-set-options/{option_id}")):
        assert want in paths, want


for name, fn in list(globals().items()):
    if name.startswith("test_") and callable(fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            fails.append(f"{name}: {type(e).__name__} {e}")

if fails:
    for f in fails:
        print("FAIL:", f)
    sys.exit(1)
print("ALL PASS")
