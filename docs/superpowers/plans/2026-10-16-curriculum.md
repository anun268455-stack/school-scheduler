# Curriculum (หลักสูตร) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the curriculum the master reference for which subjects a class may take — enter it per plan, attach classes to it, reconcile each class against it, audit the whole school, and refuse teaching-plan rows that fall outside it.

**Architecture:** A new `curriculum.py` module holds all curriculum logic and is bound to the live tables by `mock_api.py` the same way `substitution.py` already is. `mock_api.py` gains only thin endpoints, four persistence hook-ups, and one enforcement call inside the three requirement-writing endpoints. The React app gains a CRUD panel, a diff/apply modal and an audit screen, all following the existing panel/modal patterns.

**Tech Stack:** Python 3 (FastAPI-shaped single-process API, plain dict/list tables, no ORM), React + TypeScript + Tailwind, Zustand store.

**Spec:** `docs/superpowers/specs/2026-10-16-curriculum-design.md`

**Beyond the spec:** Task 2 adds `GET`/`POST /api/curricula/derive` — build every curriculum at once by clustering the classes that already teach the same subject set. The school asked for this after the spec was approved ("ช่วยอ่านรหัสวิชาทั้งหมด พร้อมสร้างหลักสูตรแต่ละห้องให้"); it is the spec's §5.5 "สร้างจากห้องที่มีอยู่" applied to all 93 classes instead of one, and it runs against the school's own live data rather than importing anything from outside.

## Global Constraints

- Curriculum rows carry **only** `subject_id` and `weekly_count`. Never copy `duration`, `credits`, `fixed_room_id` or `department_id` into a curriculum row — the subject already answers those.
- A group with `curriculum_id` unset (`None`) is **never** enforced against. No inheritance from a parent group.
- Enforcement refuses two things only: a subject absent from the class's curriculum, and a `weekly_count` **greater** than the curriculum's. Fewer periods is allowed.
- `apply` never touches `SLOTS`. Deleting a "surplus" row removes the teaching-plan row only.
- Rows carrying `parallel_group_key` (เซ็ตห้องย่อย) or `co_teacher_id` (สอนร่วม) are never offered for automatic removal — they are reported as warnings.
- Subjects already served by a คาบเสรี window (`served_by_elective`, see `mock_api._reqs_served_by_elective`) never count as surplus.
- Generated teaching-plan rows get `teacher_id = 0` (the existing "ยังไม่ได้เลือกครู" sentinel — never `None`).
- Tests live in the project's scratchpad test directory, referred to below as `$SP`, and are picked up by `$SP/runpy.sh` by containing the literal string `ALL PASS`. Run a single one with `PYTHONPATH="$SP/stubs:/home/claude/school-scheduler" python3 $SP/<file>.py`, and `rm -f data_state.json; sleep 1` before each run.
- Frontend: no new type errors against `frontend/tsconfig.check.json` (baseline is 99 lines of stub errors), and no `no-unused-expressions` — CI runs `npm run lint` and fails the deploy on it. Never write `cond ? a() : b();` as a statement.
- All user-facing strings are Thai.

## Review Focus

1. **A subject deleted after being written into a curriculum.** The row now names a subject id that no longer exists; `diff` and `audit` must skip it and the curriculum screen must show it as a dangling row to remove, not crash. (Task 3)
2. **A group deleted while attached.** `curriculum_id` points at a live curriculum from a group that is gone; `audit` iterates groups so it disappears naturally, but the attached-count on the curriculum list must not count it. (Task 2)
3. **Bulk import with a mix of passing and failing rows.** The existing importer rejects per row and never fails the whole file; enforcement must keep that contract. (Task 6)
4. **An empty curriculum attached to a class that already has subjects.** Every subject becomes surplus; `apply` with `remove` must still be an explicit per-subject list, so nothing is wiped by one click. (Task 4)
5. **`weekly_count` of 0 or negative in a curriculum row.** Accepted writes must clamp at 0 and a 0-period row must not make every class fail enforcement for teaching that subject at all. (Task 1)

---

### Task 1: `curriculum.py` module, storage, CRUD

**Files:**
- Create: `curriculum.py`
- Modify: `mock_api.py` — import + `bind()` call near the existing `_SUB.bind(` (~line 9123); `_SAVE_KEYS` (~8617); `_snapshot()`; `_restore()` table pairs (~8661) and counter pairs (~8712); new endpoints next to the other CRUD endpoints
- Test: `$SP/curric.py`

**Interfaces:**
- Produces: `CURRICULA: list[dict]` in `mock_api`; `curriculum.bind(**tables)`; `curriculum.plan_for(group_id: int) -> dict | None`; `curriculum.normalise_rows(rows: list[dict]) -> list[dict]`
- Endpoints: `GET /api/curricula`, `GET /api/curricula/{cid}`, `POST /api/curricula`, `PUT /api/curricula/{cid}`, `DELETE /api/curricula/{cid}` → `get_curricula()`, `get_curriculum(cid)`, `create_curriculum(body)`, `update_curriculum(cid, body)`, `delete_curriculum(cid)`

- [ ] **Step 1: Write the failing test** — `$SP/curric.py`

```python
# สร้าง / แก้ / ลบ
c = M.create_curriculum({"name": "ม.4 วิทย์-คณิต"})
ok(c["id"] and c["rows"] == [], "สร้างหลักสูตรว่างได้")
M.update_curriculum(c["id"], {"rows": [{"subject_id": S0, "weekly_count": 3}]})
ok(len(M.get_curricula()[0]["rows"]) == 1, "เพิ่มแถววิชาได้")

# แถวมีแค่วิชากับคาบ — ฟิลด์อื่นถูกทิ้ง
M.update_curriculum(c["id"], {"rows": [
    {"subject_id": S0, "weekly_count": 2, "duration": 2, "credits": 1.5}]})
ok(set(M.get_curricula()[0]["rows"][0]) == {"subject_id", "weekly_count"},
   "แถวเก็บแค่ subject_id กับ weekly_count")

# วิชาซ้ำในชุดเดียวกัน → รวมเป็นแถวเดียว ใช้ค่ามากกว่า
M.update_curriculum(c["id"], {"rows": [
    {"subject_id": S0, "weekly_count": 2}, {"subject_id": S0, "weekly_count": 4}]})
ok(len(M.get_curricula()[0]["rows"]) == 1
   and M.get_curricula()[0]["rows"][0]["weekly_count"] == 4, "วิชาซ้ำถูกรวม")

# คาบติดลบ → 0
M.update_curriculum(c["id"], {"rows": [{"subject_id": S0, "weekly_count": -3}]})
ok(M.get_curricula()[0]["rows"][0]["weekly_count"] == 0, "คาบติดลบกลายเป็น 0")

# ลบทั้งที่ยังมีห้องผูกอยู่ → ปฏิเสธ พร้อมบอกชื่อห้อง
G0["curriculum_id"] = c["id"]
raises(lambda: M.delete_curriculum(c["id"]), G0["name"], "ลบไม่ได้ถ้ายังมีห้องผูก")
G0["curriculum_id"] = None
ok(M.delete_curriculum(c["id"])["removed"] == 1, "ปลดห้องแล้วลบได้")

# ห้องที่ถูกลบไปแล้ว ไม่ถูกนับว่าผูกอยู่
GHOST["curriculum_id"] = c["id"]
M.del_group(GHOST["id"])
ok(M.get_curricula()[0]["groups"] == [], "ห้องที่ถูกลบไม่ถูกนับว่ายังผูกอยู่")

# plan_for ไม่สืบทอดจากห้องแม่
c2 = M.create_curriculum({"name": "แม่"})
PARENT["curriculum_id"] = c2["id"]
ok(CUR.plan_for(KID["id"]) is None, "ห้องย่อยไม่สืบทอดหลักสูตรของห้องแม่")

# บันทึก/กู้คืนครบ
snap = M._snapshot()
M.CURRICULA.clear()
M._restore(snap)
ok(len(M.CURRICULA) == 1, "กู้คืนแล้วหลักสูตรยังอยู่")
ok(M._counters["curriculum"] >= c2["id"], "ตัวนับ id ถูกกู้คืนด้วย")
```

- [ ] **Step 2: Run it and confirm it fails** — `AttributeError: module 'mock_api' has no attribute 'create_curriculum'`

- [ ] **Step 3: Write `curriculum.py`**

Mirror `substitution.py`: module-level `DATA: dict[str, Any]`, `bind(**tables)`, `_t(name)`. Implement `normalise_rows(rows)` (keep only the two keys, clamp `weekly_count` to `max(0, int(...))`, merge duplicate `subject_id` keeping the larger count, drop rows whose `subject_id` is falsy) and `plan_for(group_id)` (look up the group, read `curriculum_id`, return the curriculum dict or `None`; no parent walk).

- [ ] **Step 4: Wire `mock_api.py`**

Add `CURRICULA: list[dict[str, Any]] = []` beside the other tables; add `"curricula"` to `_SAVE_KEYS`, to `_snapshot()`, to the `_restore()` table pairs and to the `_restore()` counter pairs as `("curriculum", CURRICULA)`; `import curriculum as _CUR` and extend the existing bind call with `curricula=lambda: CURRICULA`, `groups_by_id=lambda: {g["id"]: g for g in _flat_groups()}`, `subjects_by_id=lambda: {s["id"]: s for s in SUBJECTS}`, `requirements=lambda: REQUIREMENTS`.

Then the four endpoints. `get_curricula()` returns each curriculum plus `"groups": [group ids currently attached]` and `"group_names": [...]`, counting only ids that still resolve to a live group. `delete_curriculum` raises `HTTPException(400, ...)` naming up to three attached class names when any are attached.

- [ ] **Step 5: Run the test — PASS**

- [ ] **Step 6: Commit** — `git add curriculum.py mock_api.py && git commit -m "หลักสูตร: ตัวข้อมูลกับการกรอกแถว"`

---

### Task 2: Copy, build-from-class, auto-derive

**Files:**
- Modify: `curriculum.py`, `mock_api.py`
- Test: `$SP/curricgen.py`

**Interfaces:**
- Consumes: Task 1's `CURRICULA`, `normalise_rows`
- Produces: `curriculum.rows_from_group(group_id) -> list[dict]`; `curriculum.derive_all() -> list[dict]` returning proposals shaped `{"name": str, "rows": [...], "group_ids": [int], "variants": int}`
- Endpoints: `POST /api/curricula/{cid}/copy`, `POST /api/curricula/from-group/{gid}`, `GET /api/curricula/derive`, `POST /api/curricula/derive`

`derive_all` clusters every group that has teaching-plan rows by its exact frozen set of `(subject_id, weekly_count)`; each cluster becomes one proposal named `"<level> <plan>"` from the groups' own `level`/`plan` fields, with a trailing `" (แบบ N)"` when one `(level, plan)` pair yields more than one cluster. `variants` is how many clusters that pair produced. `GET` returns the proposals; `POST` creates them and attaches the groups.

- [ ] **Step 1: Write the failing test** — `$SP/curricgen.py`

```python
# ก๊อปปี้ได้ชุดใหม่ แก้แล้วไม่กระทบของเดิม
src = M.create_curriculum({"name": "ต้นฉบับ", "rows": [{"subject_id": S0, "weekly_count": 3}]})
cp = M.copy_curriculum(src["id"])
ok(cp["id"] != src["id"] and cp["rows"] == src["rows"], "ก๊อปปี้ได้วิชาครบ")
ok("สำเนา" in cp["name"], "ชื่อบอกว่าเป็นสำเนา")
ok(cp["groups"] == [], "สำเนายังไม่มีห้องผูก")
M.update_curriculum(cp["id"], {"rows": []})
ok(len(M.get_curriculum(src["id"])["rows"]) == 1, "แก้สำเนาไม่กระทบต้นฉบับ")

# สร้างจากห้องที่มีอยู่
made = M.curriculum_from_group(G0["id"])
ok({r["subject_id"] for r in made["rows"]}
   == {r["subject_id"] for r in M.REQUIREMENTS if r["group_id"] == G0["id"]},
   "ได้วิชาของห้องนั้นครบ")
ok(G0.get("curriculum_id") is None, "สร้างแล้วยังไม่ผูกห้องให้เอง")

# สร้างอัตโนมัติ: ห้องที่วิชาเหมือนกันเป๊ะรวมเป็นชุดเดียว
prop = M.derive_curricula()["proposals"]
same = [p for p in prop if len(p["group_ids"]) > 1]
ok(same, "ห้องที่เหมือนกันถูกรวมเป็นหลักสูตรเดียว")
ok(all(p["rows"] for p in prop), "ทุกชุดที่เสนอมีวิชาอย่างน้อยหนึ่งวิชา")
ok(sum(len(p["group_ids"]) for p in prop)
   == len({r["group_id"] for r in M.REQUIREMENTS}), "ทุกห้องที่มีวิชาอยู่ในชุดใดชุดหนึ่ง")
ok(len({tuple(sorted(p["group_ids"])) for p in prop}) == len(prop), "ไม่มีห้องซ้ำสองชุด")
ok(any(p["variants"] > 1 for p in prop), "แผนเดียวกันที่เรียนต่างกันถูกแยกเป็นหลายแบบ")

# GET ไม่สร้างอะไร
before = len(M.CURRICULA)
M.derive_curricula()
ok(len(M.CURRICULA) == before, "ดูข้อเสนอแล้วยังไม่มีอะไรถูกสร้าง")

# POST สร้างและผูกให้
res = M.apply_derived_curricula({})
ok(len(M.CURRICULA) == before + len(prop), "กดแล้วสร้างครบทุกชุด")
ok(all(g.get("curriculum_id") for g in M._flat_groups()
       if any(r["group_id"] == g["id"] for r in M.REQUIREMENTS)),
   "ทุกห้องที่มีวิชาถูกผูกหลักสูตรแล้ว")
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement** `rows_from_group`, `derive_all` in `curriculum.py` and the four endpoints in `mock_api.py`.

- [ ] **Step 4: Run the test — PASS**

- [ ] **Step 5: Run `derive_all` against the real seed and record the shape**

Run a one-off script over `school_data.json` printing: number of proposals, how many classes each covers, and which `(level, plan)` pairs produced more than one variant. Paste the counts into the commit message — this is the number the school will see.

- [ ] **Step 6: Commit** — `"หลักสูตร: ก๊อปปี้ สร้างจากห้อง และสร้างอัตโนมัติจากข้อมูลเดิม"`

---

### Task 3: Attach classes, and the diff

**Files:**
- Modify: `curriculum.py`, `mock_api.py`
- Test: `$SP/curricdiff.py`

**Interfaces:**
- Consumes: Task 1's `plan_for`
- Produces: `curriculum.diff(group_id) -> dict` shaped
  `{"curriculum": {...} | None, "add": [...], "fix": [...], "remove": [...], "warn": [...], "ok": int}`
  where every `add`/`fix`/`remove` entry is `{"subject_id", "code", "name", "want", "have"}` and every `warn` entry adds `"why"`.
- Endpoints: `PUT /api/curricula/{cid}/groups` (body `{"group_ids": [...]}`), `GET /api/curricula/diff/{gid}`

Classification: a curriculum subject with no requirement row → `add`; a row whose `weekly_count` differs → `fix`; a requirement subject absent from the curriculum → `remove`, unless the row has `parallel_group_key` or `co_teacher_id` or the subject is served by an elective, in which case it goes to `warn` with a Thai reason. Curriculum rows whose `subject_id` no longer resolves to a live subject go to `warn` with `"วิชานี้ถูกลบออกจากระบบแล้ว"` and never to `add`.

- [ ] **Step 1: Write the failing test** — `$SP/curricdiff.py`

```python
# ผูกห้อง ไม่แตะวิชาของห้องเลย
before = [dict(r) for r in M.REQUIREMENTS]
M.set_curriculum_groups(c["id"], {"group_ids": [G0["id"]]})
ok(M.REQUIREMENTS == before, "ผูกห้องแล้วแผนการสอนไม่เปลี่ยนสักแถว")
ok(G0["curriculum_id"] == c["id"], "ห้องถูกผูกแล้ว")
M.set_curriculum_groups(c["id"], {"group_ids": []})
ok(G0.get("curriculum_id") is None, "ปลดห้องได้")

# diff สามทาง
# หลักสูตร: S0 3 คาบ, S1 2 คาบ · ห้อง: S0 2 คาบ, S2 2 คาบ
d = M.curriculum_diff(G0["id"])
ok([x["subject_id"] for x in d["add"]] == [S1], "วิชาที่ขาดขึ้นในช่องเพิ่ม")
ok(d["fix"][0]["subject_id"] == S0 and d["fix"][0]["want"] == 3
   and d["fix"][0]["have"] == 2, "คาบไม่ตรงบอกทั้งค่าที่ควรเป็นและค่าที่มี")
ok([x["subject_id"] for x in d["remove"]] == [S2], "วิชาที่เกินขึ้นในช่องเอาออก")

# แถวในเซ็ตห้องย่อย / สอนร่วม ไม่ถูกเสนอให้ลบ
req_set["parallel_group_key"] = "SET:x"
d = M.curriculum_diff(G0["id"])
ok(req_set["subject_id"] not in [x["subject_id"] for x in d["remove"]],
   "แถวในเซ็ตไม่ถูกเสนอให้ลบ")
ok(any(x["subject_id"] == req_set["subject_id"] for x in d["warn"]), "แต่ขึ้นเป็นคำเตือน")

# วิชาที่อยู่ในคาบเสรีแล้ว ไม่นับว่าเกิน
ok(ELEC_SUBJ not in [x["subject_id"] for x in d["remove"]], "วิชาในคาบเสรีไม่นับว่าเกิน")

# วิชาที่ถูกลบออกจากระบบแล้ว
M.update_curriculum(c["id"], {"rows": [{"subject_id": 999999, "weekly_count": 1}]})
d = M.curriculum_diff(G0["id"])
ok(not any(x["subject_id"] == 999999 for x in d["add"]), "วิชาที่ไม่มีแล้วไม่ถูกเสนอให้สร้าง")
ok(any(x["subject_id"] == 999999 for x in d["warn"]), "แต่ขึ้นเป็นคำเตือนให้ไปลบออก")

# ห้องที่ไม่ผูกหลักสูตร
d = M.curriculum_diff(G_FREE["id"])
ok(d["curriculum"] is None and not d["add"] and not d["remove"],
   "ห้องที่ไม่ผูกหลักสูตร ไม่มีอะไรให้เทียบ")
```

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement** `diff` in `curriculum.py` and the two endpoints.
- [ ] **Step 4: Run the test — PASS**
- [ ] **Step 5: Commit** — `"หลักสูตร: ผูกห้อง และตารางเทียบ"`

---

### Task 4: Apply the diff

**Files:**
- Modify: `curriculum.py`, `mock_api.py`
- Test: `$SP/curricapply.py`

**Interfaces:**
- Consumes: Task 3's `diff`
- Produces: `curriculum.apply(group_id, add: list[int], fix: list[int], remove: list[int]) -> dict` returning `{"added", "fixed", "removed", "slots_left"}` — `slots_left` counts placed lessons of removed subjects that are now unbacked.
- Endpoint: `POST /api/curricula/apply/{gid}`

Lists hold `subject_id`s, and only subjects the current `diff` puts in that bucket are acted on — anything else is ignored silently, so a stale screen cannot delete something it was not showing.

- [ ] **Step 1: Write the failing test** — `$SP/curricapply.py`

```python
# ทำเฉพาะที่ติ๊ก
r = M.curriculum_apply(G0["id"], {"add": [S1], "fix": [], "remove": []})
ok(r["added"] == 1 and r["fixed"] == 0 and r["removed"] == 0, "ทำเฉพาะที่ติ๊ก")
new = next(x for x in M.REQUIREMENTS if x["group_id"] == G0["id"] and x["subject_id"] == S1)
ok(new["teacher_id"] == 0, "แถวใหม่เว้นครูไว้")
ok(new["weekly_count"] == 3, "คาบตามหลักสูตร")

# แก้คาบ
M.curriculum_apply(G0["id"], {"add": [], "fix": [S0], "remove": []})
ok(next(x for x in M.REQUIREMENTS if x["subject_id"] == S0)["weekly_count"] == 3,
   "คาบถูกแก้ให้ตรงหลักสูตร")

# เอาออก — ลบแถว ไม่แตะตาราง
slots_before = len(M.SLOTS)
r = M.curriculum_apply(G0["id"], {"add": [], "fix": [], "remove": [S2]})
ok(not any(x["group_id"] == G0["id"] and x["subject_id"] == S2 for x in M.REQUIREMENTS),
   "แถวถูกลบ")
ok(len(M.SLOTS) == slots_before, "คาบในตารางไม่ถูกแตะ")
ok(r["slots_left"] > 0, "แต่บอกว่ายังมีคาบในตารางที่ไม่มีแผนรองรับแล้ว")

# รหัสวิชาที่ไม่ได้อยู่ในช่องนั้น ถูกเพิกเฉย
r = M.curriculum_apply(G0["id"], {"add": [], "fix": [], "remove": [S_UNRELATED]})
ok(r["removed"] == 0, "วิชาที่ไม่ได้อยู่ในช่อง 'เอาออก' ไม่ถูกลบ")

# หลักสูตรว่างเปล่า — ไม่ลบทั้งห้องด้วยคลิกเดียว
M.update_curriculum(c["id"], {"rows": []})
r = M.curriculum_apply(G0["id"], {"add": [], "fix": [], "remove": []})
ok(r["removed"] == 0 and any(x["group_id"] == G0["id"] for x in M.REQUIREMENTS),
   "ไม่ส่งรายการมา = ไม่ลบอะไรเลย")

# หลังปรับเสร็จ ไม่เหลืออะไรให้เทียบ
M.update_curriculum(c["id"], {"rows": ROWS})
d = M.curriculum_diff(G0["id"])
M.curriculum_apply(G0["id"], {"add": [x["subject_id"] for x in d["add"]],
                              "fix": [x["subject_id"] for x in d["fix"]],
                              "remove": [x["subject_id"] for x in d["remove"]]})
d2 = M.curriculum_diff(G0["id"])
ok(not d2["add"] and not d2["fix"] and not d2["remove"], "ปรับครบแล้วห้องตรงหลักสูตร")
```

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement** `apply` and the endpoint.
- [ ] **Step 4: Run the test — PASS**
- [ ] **Step 5: Commit** — `"หลักสูตร: ปรับห้องให้ตรงตามที่ติ๊ก"`

---

### Task 5: School-wide audit

**Files:**
- Modify: `curriculum.py`, `mock_api.py`
- Test: `$SP/curricaudit.py`

**Interfaces:**
- Consumes: Task 3's `diff`
- Produces: `curriculum.audit() -> dict` → `{"rows": [...], "total": int, "attached": int, "off": int}`, one row per group that has a curriculum **or** any teaching-plan row: `{"group_id", "group_name", "curriculum_id", "curriculum_name", "missing", "surplus", "mismatch", "warn", "weekly"}` (`weekly` = total periods the class's rows ask for).
- Endpoint: `GET /api/curricula/audit`

- [ ] **Step 1: Write the failing test** — `$SP/curricaudit.py`

```python
a = M.curriculum_audit()
row = {r["group_id"]: r for r in a["rows"]}[G0["id"]]
ok(row["missing"] == 1 and row["surplus"] == 1 and row["mismatch"] == 1,
   "นับขาด/เกิน/คาบไม่ตรงได้ถูก")
ok(row["curriculum_name"] == c["name"], "บอกชื่อหลักสูตรที่ผูกไว้")
ok(row["weekly"] == sum(r["weekly_count"] for r in M.REQUIREMENTS
                        if r["group_id"] == G0["id"]), "บอกคาบรวมของห้อง")
ok(a["off"] >= 1, "นับห้องที่ยังไม่ตรง")

# ห้องที่ไม่ผูกหลักสูตรแต่มีวิชา ยังอยู่ในรายงาน
free = {r["group_id"]: r for r in a["rows"]}[G_FREE["id"]]
ok(free["curriculum_id"] is None and free["missing"] == 0,
   "ห้องที่ยังไม่ผูก ขึ้นในรายงานแต่ไม่ถูกนับว่าขาด")

# ปรับให้ตรงแล้วหายจากรายการที่ไม่ตรง
M.curriculum_apply(G0["id"], ALL_OF_DIFF)
ok({r["group_id"]: r for r in M.curriculum_audit()["rows"]}[G0["id"]]["missing"] == 0,
   "ปรับแล้วไม่ขาดอีก")
ok(M.curriculum_audit()["attached"] >= 1, "นับห้องที่ผูกหลักสูตรแล้ว")
```

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement** `audit` and the endpoint.
- [ ] **Step 4: Run the test — PASS**
- [ ] **Step 5: Commit** — `"หลักสูตร: หน้าตรวจทั้งโรงเรียน"`

---

### Task 6: Enforcement

**Files:**
- Modify: `curriculum.py`; `mock_api.py` — `create_req` (~6864), `update_req` (~6914), `bulk_create_reqs` (~6932)
- Test: `$SP/curriclock.py`

**Interfaces:**
- Consumes: Task 1's `plan_for`
- Produces: `curriculum.check_row(group_id, subject_id, weekly_count) -> str | None` — `None` means allowed, otherwise the Thai refusal message.

Call it in all three endpoints. `create_req` and `update_req` raise `HTTPException(400, msg)`; `bulk_create_reqs` appends `{"row": i, "reason": msg}` to its existing `rejected` list and continues. `update_req` checks the values **after** the merge and against the destination group when `group_id` changes.

- [ ] **Step 1: Write the failing test** — `$SP/curriclock.py`

```python
# ห้องที่ไม่ผูกหลักสูตร → ไม่ถูกบังคับ
ok(M.create_req({"group_id": G_FREE["id"], "subject_id": S_ANY,
                 "teacher_id": T0, "weekly_count": 2})["id"], "ห้องที่ไม่ผูกยังเพิ่มได้")

# วิชานอกหลักสูตร → ปฏิเสธ พร้อมบอกชื่อหลักสูตร
msg = raises(lambda: M.create_req({"group_id": G0["id"], "subject_id": S_OUT,
                                   "teacher_id": T0, "weekly_count": 1}))
ok(c["name"] in msg and "หลักสูตร" in msg, "บอกว่าติดหลักสูตรชุดไหน")

# คาบเกิน → ปฏิเสธ · คาบน้อยกว่า → ผ่าน
raises(lambda: M.create_req({"group_id": G0["id"], "subject_id": S0,
                             "teacher_id": T0, "weekly_count": 99}))
ok(M.create_req({"group_id": G0["id"], "subject_id": S0,
                 "teacher_id": T0, "weekly_count": 1})["id"], "คาบน้อยกว่าหลักสูตรผ่าน")

# แก้แถว — เช็กค่าหลังแก้
raises(lambda: M.update_req(existing["id"], {"weekly_count": 99}))
raises(lambda: M.update_req(existing["id"], {"subject_id": S_OUT}))
# ย้ายแถวไปห้องอื่น — เช็กกับหลักสูตรของห้องปลายทาง
raises(lambda: M.update_req(existing["id"], {"group_id": G_STRICT["id"]}))

# นำเข้าเป็นชุด — แถวที่ไม่ผ่านถูกปฏิเสธรายแถว ไม่ล้มทั้งไฟล์
res = M.bulk_create_reqs([
    {"group_id": G0["id"], "subject_id": S0, "teacher_id": T0, "weekly_count": 1},
    {"group_id": G0["id"], "subject_id": S_OUT, "teacher_id": T0, "weekly_count": 1},
])
ok(len(res["created"]) == 1 and len(res["rejected"]) == 1, "แถวดีผ่าน แถวเสียถูกปฏิเสธ")
ok("หลักสูตร" in res["rejected"][0]["reason"], "และบอกเหตุผล")

# แถวที่หลักสูตรกำหนดไว้ 0 คาบ
M.update_curriculum(c["id"], {"rows": [{"subject_id": S0, "weekly_count": 0}]})
raises(lambda: M.create_req({"group_id": G0["id"], "subject_id": S0,
                             "teacher_id": T0, "weekly_count": 1}))

# ตัวปรับห้องให้ตรงหลักสูตร ไม่ถูกบังคับทับตัวเอง
M.update_curriculum(c["id"], {"rows": ROWS})
ok(M.curriculum_apply(G0["id"], {"add": [S1], "fix": [], "remove": []})["added"] == 1,
   "การปรับให้ตรงหลักสูตรทำงานได้ตามปกติ")
```

- [ ] **Step 2: Run it and confirm it fails**
- [ ] **Step 3: Implement** `check_row` and the three call sites.
- [ ] **Step 4: Run the test — PASS**
- [ ] **Step 5: Run the whole suite** — `bash $SP/runpy.sh`; every pre-existing test must still pass. Any failure here means enforcement leaked into a path the spec excludes — fix the call site, not the test.
- [ ] **Step 6: Commit** — `"หลักสูตร: บังคับตอนเขียนแผนการสอน"`

---

### Task 7: Curriculum management screen

**Files:**
- Create: `frontend/src/components/curriculum/CurriculumPanel.tsx`
- Modify: `frontend/src/api/client.ts`; `frontend/src/pages/Dashboard.tsx` (`DashPage` union + `pageMap`, ~line 46); `frontend/src/components/layout/TopNavbar.tsx` (`CRUD_ITEMS`, ~line 91)
- Test: typecheck + lint only (no logic worth a unit test; the logic is Tasks 1-6)

**Interfaces:**
- Consumes: Tasks 1-2 endpoints
- Produces: client functions `fetchCurricula`, `createCurriculum`, `updateCurriculum`, `deleteCurriculum`, `copyCurriculum`, `curriculumFromGroup`, `fetchDerivedCurricula`, `applyDerivedCurricula`, `setCurriculumGroups` and the types `Curriculum`, `CurriculumRow`, `DerivedProposal`

- [ ] **Step 1: Add the client functions and types** to `api/client.ts`, following the shape of the existing `fetchPeriodCheck`/`savePeriodTargets` pair.

- [ ] **Step 2: Build `CurriculumPanel.tsx`** — left: list of curricula with attached-class count; right: the selected curriculum's rows (subject picker + periods input, add/remove), rename, 📋 ก๊อปปี้, and a class-attach multi-select. Header carries **"✨ สร้างหลักสูตรอัตโนมัติจากข้อมูลเดิม"**, which calls `GET /api/curricula/derive`, shows the proposals (name · how many classes · how many subjects) and only creates them on confirm. Follow `Section`/`Field`/`inputCls` from `Dashboard.tsx` and `SearchableSelect` + `subjectOptions` from `components/common/SearchableSelect.tsx`.

- [ ] **Step 3: Register the page** — add `"curriculum"` to `DashPage`, `curriculum: <CurriculumPanel />` to `pageMap`, and `{ id: "curriculum", icon: "📚", label: "หลักสูตร", divider: false }` to `CRUD_ITEMS`.

- [ ] **Step 4: Verify** — `cd frontend && npx tsc -p tsconfig.check.json`, normalise with `sed -E 's/\([0-9]+,[0-9]+\)//' | sort`, diff against the 99-line baseline: no new lines. Grep the new file for `?` used as a statement.

- [ ] **Step 5: Commit** — `"หลักสูตร: หน้าจัดการหลักสูตร"`

---

### Task 8: Diff/apply modal, audit screen, refusal message

**Files:**
- Create: `frontend/src/components/curriculum/CurriculumDiffModal.tsx`, `frontend/src/components/curriculum/CurriculumAuditModal.tsx`
- Modify: `frontend/src/api/client.ts`; `frontend/src/components/layout/TopNavbar.tsx` (tools menu, beside 📐 ตรวจคาบสุดท้าย); `CurriculumPanel.tsx` (open the diff modal per class); the requirement-add screen that surfaces the 400 message

**Interfaces:**
- Consumes: Tasks 3-5 endpoints
- Produces: client functions `fetchCurriculumDiff`, `applyCurriculumDiff`, `fetchCurriculumAudit`

- [ ] **Step 1: Add the three client functions and their types.**

- [ ] **Step 2: Build `CurriculumDiffModal.tsx`** — one row per entry, grouped ➕ เพิ่ม / ✏️ แก้คาบ / ➖ เอาออก, each with a checkbox; ➕ and ✏️ ticked by default, **➖ unticked by default** (deleting is the one irreversible direction). Warnings render as a non-tickable amber list. Footer counts what will happen and applies on confirm; `slots_left > 0` after applying shows the Thai note that those lessons now have no plan behind them.

- [ ] **Step 3: Build `CurriculumAuditModal.tsx`** — table of class · curriculum · ขาด · เกิน · คาบไม่ตรง · คำเตือน · คาบรวม, a "แสดงเฉพาะห้องที่ไม่ตรง" filter, and a per-row button opening the diff modal. Model it on `components/solver/PeriodCheckModal.tsx`.

- [ ] **Step 4: Register in the tools menu** — `📚 ตรวจหลักสูตร`, next to `📐 ตรวจคาบสุดท้าย / คาบว่าง`.

- [ ] **Step 5: Surface the refusal** — where adding a teaching-plan row catches an error, show the server's `detail` verbatim (it already names the curriculum) rather than a generic failure message.

- [ ] **Step 6: Verify** — typecheck diff clean, lint pattern grep clean, `bash $SP/runpy.sh` and `bash $SP/runts.sh` both green.

- [ ] **Step 7: Commit and push** — `"หลักสูตร: หน้าเทียบ หน้าตรวจ และข้อความตอนถูกปฏิเสธ"`, then push and confirm the GitHub Pages workflow reports success.
