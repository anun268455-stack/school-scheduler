"""
เว็บลงอัตรากำลัง ขั้นที่ 2 งานที่ 6: รายการห้องเรียน/ห้องพิเศษให้หน้าเว็บ (อ่านอย่างเดียว)

GET /api/workload/groups — ห้องเรียนที่ใส่ในหลักสูตรได้ (ช่องติ๊กห้องของหน้าหลักสูตร)
GET /api/workload/rooms  — ห้องของโปรแกรมจัดตาราง (ห้องปฏิบัติการของหน้ากรอก งานที่ 8)

จุดที่ต้องไม่พลาด: ต้องล็อกอิน · ชุดห้องเรียนต้องเป็นชุดเดียวกับที่การตั้งต้นหลักสูตรใช้ (ไม่งั้นมีห้องที่ตั้งต้นได้แต่ติ๊กไม่ได้)
· ข้อมูลของโปรแกรมจัดตารางห้ามถูกแก้ แม้ผู้เรียกแก้ผลที่ได้ไป · ไม่แตะฐานข้อมูลนอกจากตรวจ session
"""
import contextlib
import copy
import datetime as dt
import re
import sys
from types import SimpleNamespace

from fastapi import HTTPException

import mock_api

fails: list[str] = []
REQ = SimpleNamespace(headers={"authorization": "Bearer tok"})
NOREQ = SimpleNamespace(headers={})


def _sess(role):
    h = mock_api.wl_token_hash("tok")
    exp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    return (h, 7, role, None if role == "admin" else 2, "x", exp)


class _Cur:
    """cursor ปลอม: ตอบได้แค่คำถามเรื่อง session · คำสั่งอื่นทุกตัวคือการแตะฐานข้อมูลที่ไม่ควรมี"""
    def __init__(self, session_row):
        self.session_row = session_row
        self.log: list[str] = []
        self._out: list = []

    def execute(self, sql, params=None):
        self.log.append(sql)
        if "wl_sessions" not in sql:
            raise AssertionError(f"route นี้ไม่ควรถามฐานข้อมูลนอกจาก session: {sql}")
        self._out = [self.session_row] if self.session_row else []

    def fetchall(self):
        return list(self._out)

    def fetchone(self):
        return self._out[0] if self._out else None


def _call(fn, cur, *a):
    @contextlib.contextmanager
    def fake():
        yield cur
    saved = mock_api._wl_db
    mock_api._wl_db = fake
    try:
        return fn(*a)
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


def _groups(role="head"):
    return _call(mock_api.wl_groups_list, _Cur(_sess(role)), REQ)


def _rooms(role="head"):
    return _call(mock_api.wl_rooms_list, _Cur(_sess(role)), REQ)


def test_both_routes_are_registered_as_get():
    paths = {(v.lower(), p) for v, p, _ in mock_api.app.routes}
    assert ("get", "/api/workload/groups") in paths
    assert ("get", "/api/workload/rooms") in paths


def test_both_need_login_with_thai_401():
    for fn in (mock_api.wl_groups_list, mock_api.wl_rooms_list):
        c, d = _code(lambda: _call(fn, _Cur(None), NOREQ))
        assert c == 401 and _thai(d), (fn.__name__, c, d)
        # มี token แต่ session ไม่มีแล้ว (หมดอายุ/รหัสถูกปิด) ก็ 401 เหมือนกัน
        c, d = _code(lambda: _call(fn, _Cur(None), REQ))
        assert c == 401 and _thai(d), (fn.__name__, c, d)


def test_every_role_can_read_and_only_the_session_is_queried():
    for role in ("admin", "head"):
        for fn in (mock_api.wl_groups_list, mock_api.wl_rooms_list):
            cur = _Cur(_sess(role))
            out = _call(fn, cur, REQ)
            assert out, (role, fn.__name__)
            assert len(cur.log) == 1 and "wl_sessions" in cur.log[0], cur.log


def test_shape_is_exactly_id_and_name():
    for out in (_groups(), _rooms()):
        for item in out:
            assert set(item) == {"id", "name"}, item
            assert type(item["id"]) is int and isinstance(item["name"], str) and item["name"], item


def test_seed_data_has_93_groups_and_every_room():
    groups = _groups()
    assert len(groups) == 93
    assert {g["id"] for g in groups} == {g["id"] for g in mock_api._flat_groups()}
    rooms = _rooms()
    assert len(rooms) == len(mock_api.ROOMS) == 136
    assert {r["id"] for r in rooms} == {r["id"] for r in mock_api.ROOMS}
    assert len({g["id"] for g in groups}) == 93 and len({r["id"] for r in rooms}) == 136


def test_groups_are_the_set_that_seeding_puts_into_curricula_and_writes_accept():
    # การตั้งต้นจากโปรแกรมจัดตารางใช้ห้องจาก _flat_groups() (src["groups"]) และ route เขียนของหลักสูตรรับห้องจาก
    # _wl_group_names() — ห้องที่ติ๊กได้ต้องเป็นชุดเดียวกันทั้งสามที่
    src = {"requirements": copy.deepcopy(mock_api.REQUIREMENTS), "pools": copy.deepcopy(mock_api.ELECTIVE_POOLS),
           "slots": [], "sched_subjects": {s["id"]: s for s in copy.deepcopy(mock_api.SUBJECTS)},
           "groups": {g["id"]: g for g in copy.deepcopy(mock_api._flat_groups())},
           "teacher_ids": {}, "subject_ids": {}, "subject_depts": {}, "served": set()}
    plan = mock_api.wl_curricula_from_proposal(mock_api.wl_round_proposal(src), src["groups"])
    seeded = {g for c in plan["curricula"] for g in c["group_ids"]}
    ids = {g["id"] for g in _groups()}
    assert seeded == ids, (sorted(seeded ^ ids))
    assert ids == set(mock_api._wl_group_names())
    # ชื่อเดียวกับ group_names ที่หน้าหลักสูตรได้จาก GET /curricula
    names = mock_api._wl_group_names()
    assert all(g["name"] == mock_api._wl_group_label(g["id"], names) for g in _groups())


def test_groups_sorted_like_class_sort_level_then_room_number_then_suffix():
    names = [g["name"] for g in _groups()]
    assert names[:3] == ["ม.1/1", "ม.1/2", "ม.1/3"]
    # เรียงแบบเลข ไม่ใช่แบบตัวอักษร: 1/9 ก่อน 1/10
    assert names.index("ม.1/9") < names.index("ม.1/10") < names.index("ม.1/11") < names.index("ม.2/1")
    # ห้องย่อยตามหลังห้องแม่ ก่อนห้องถัดไป
    i = names.index("ม.4/6")
    assert names[i:i + 5] == ["ม.4/6", "ม.4/6ก", "ม.4/6ข", "ม.4/6ค", "ม.4/7"], names[i:i + 5]
    assert names[-1].startswith("ม.6/")
    keys = [mock_api.wl_class_key(n) for n in names]
    assert keys == sorted(keys)


def test_class_key_rule():
    k = mock_api.wl_class_key
    assert k("ม.1/2") < k("ม.1/10") < k("ม.2/1")
    assert k("ม.4/6") < k("ม.4/6ก") < k("ม.4/6ข") < k("ม.4/7")
    assert k(" ม. 3 / 4 ") == k("ม.3/4")
    # ชื่อที่ไม่ใช่รูป ม.N/… ไว้ท้าย เรียงตามตัวอักษร
    assert k("ม.6/12") < k("ห้องพิเศษ") and k("ก") < k("ข")
    assert k(None) == k("")


def test_odd_group_names_sort_last_and_empty_name_gets_a_label():
    saved = mock_api.GROUPS
    mock_api.GROUPS = [{"id": 5, "name": "ห้องพิเศษ", "children": []},
                       {"id": 3, "name": "ม.2/10", "children": [{"id": 9, "name": "", "children": []}]},
                       {"id": 4, "name": "ม.2/9", "children": []}]
    try:
        out = _groups()
    finally:
        mock_api.GROUPS = saved
    assert out == [{"id": 4, "name": "ม.2/9"}, {"id": 3, "name": "ม.2/10"}, {"id": 5, "name": "ห้องพิเศษ"},
                   {"id": 9, "name": "ห้องรหัส 9"}], out


def test_rooms_sorted_by_name():
    names = [r["name"] for r in _rooms()]
    assert names == sorted(names)
    assert names[0] == "001 ศูนย์1"
    # ข้อมูลตั้งต้นเรียงตามชื่ออยู่แล้วเกือบทั้งหมด — ต้องเห็นว่า route เรียงเอง ไม่ใช่พึ่งลำดับของ ROOMS
    saved = mock_api.ROOMS
    mock_api.ROOMS = [{"id": 1, "name": "ห้องวิทย์ 2"}, {"id": 2, "name": "101 ห้องคอม"}, {"id": 3, "name": ""}]
    try:
        out = _rooms()
    finally:
        mock_api.ROOMS = saved
    assert out == [{"id": 2, "name": "101 ห้องคอม"}, {"id": 3, "name": "ห้องรหัส 3"}, {"id": 1, "name": "ห้องวิทย์ 2"}], out


def test_timetable_data_is_not_changed_even_when_the_caller_edits_the_result():
    before = copy.deepcopy((mock_api.GROUPS, mock_api.ROOMS))
    for out in (_groups("admin"), _rooms("admin"), _groups("head"), _rooms("head")):
        for item in out:
            item["name"] = "เปลี่ยน"
            item["id"] = -1
    assert (mock_api.GROUPS, mock_api.ROOMS) == before


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
