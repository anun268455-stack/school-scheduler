# SDD ledger — plan: docs/superpowers/plans/2026-11-06-term-layer.md

Spec: docs/superpowers/specs/2026-11-06-workload-entry-site-design.md (ส่วนที่ 8) — reachable, read.
Worktree: /home/claude/school-scheduler/.worktrees/term-layer on branch `term-layer`
Baseline: `bash tests/run.sh` → ผ่าน 6 · ไม่ผ่าน 0 (clean)

## Setup rulings

Ruling: created an isolated git worktree `.worktrees/term-layer` on branch `term-layer` rather than
working on `main` — why: main auto-deploys to GitHub Pages and the live Render backend on push, and
this is a 9-task change to the file holding the school's live timetable — cost if wrong: none; the
worktree is git-ignored scratch and the branch merges or is deleted at the end.

Ruling: `npm install` cannot run in this container — DNS for registry.npmjs.org fails
(`ENOTFOUND`, and the host is in the proxy's noProxy list so the proxy will not relay it); the npm
cache is incomplete so `--offline` also fails (ENOTCACHED on zustand). Tasks 1–6 are unaffected
(Python; `bash tests/run.sh` needs no node_modules and passes). For Tasks 7–9 the plan's
`npm run lint` / `tsc --noEmit` verification steps are replaced by: (a) `bash tests/run.sh`,
(b) a scripted unused-import check, (c) `tsc` with `--noResolve --skipLibCheck` against a baseline
error count from `git archive`, which needs no node_modules — cost if wrong: a lint-only CI failure
on push, visible and one commit to fix; no behavioural risk.

## Pre-flight scan

### Pairs sharing a file or an interface

| Pair | Producer → Consumer | Found |
|---|---|---|
| T1 → T2 | `_TERMS_SCHEMA`, `_terms_list`, `_term_insert`, `_require_db`, `term_label` → create_term | names match |
| T1 → T3 | `_term_row` → guard | guard never calls it; takes a dict — see **Conflict A** |
| T2 → T3 | `CURRENT_TERM {id,year,semester,label}` → `term_blocks_write` reads `term.get("status")` | **Conflict A: `CURRENT_TERM` has no `status` key, so the guard always allows writes** |
| T1 → T4 | `_term_blob`, `_term_set_status`, `_require_db` → term_data, unlock | names match |
| T2 → T4 | `CURRENT_TERM` written by both | consistent once Conflict A is fixed |
| T1 → T5 | `_terms_list`, `_term_blob`, `_unpack` → `_term_entity_index` | names match; **Conflict B: T5's own test runs with `_STORE_KIND="file"` and expects three empty sets, but the plan only says to skip *unreadable files*, not "no database at all"** |
| T1 → T6 | `_terms_list`, `_term_blob`, `_unpack` → `term_stats_of` | names match |
| T5 ↔ T6 | both read every closed term blob | no shared code; no conflict |
| T1–T6 → T7 | `_terms_list` row keys → `TermMeta` fields | id, year, semester, label, status, slots, opened_at, closed_at, bytes — exact match |
| T7 → T8 | `TermMeta`, `sortTerms`, `activeTerm`, `nextTerm`, `canEdit` | all produced by T7 |
| T7 → T9 | `canEdit`, `termBanner` | produced by T7 |
| T8 ↔ T9 | T8: Dashboard.tsx + components/terms/ · T9: TopNavbar, grid, print, printSheet | no file overlap |
| T2 → T8 | T2 says the config page's ภาคเรียน/ปี become read-only "(Task 8)" | the inputs are in `Dashboard.tsx:3420`, which T8 already modifies — covered, no conflict |
| T9 → existing `printSheet.ts` | adds `term?: string` to `SheetSetup` | T9's own test pins `normalizeSheet({}).term === undefined`; back-compatible |

### Each task against itself

| Task | Found |
|---|---|
| T1 | tests call `mock_api.list_terms()`; Step 3 names that function — agrees |
| T2 | tests call `create_term`, `new_term_preview`, `update_school_config` — all named in Step 3 or existing (14995). Check order (validate before the duplicate-row query) matches the test that runs with `_STORE_KIND="postgres"` and never reaches the DB — agrees |
| T3 | agrees once Conflict A is fixed |
| T4 | `term_data(999)` with no DB raises and the test catches it — agrees, though the assertion is weak |
| T5 | see Conflict B |
| T6 | tests pin every returned key — agrees |
| T7 | **Conflict C: `shouldPoll(viewingClosed, dataState)` is specified as "นอกนั้นคืนเงื่อนไขเดิมของร้าน", which is not a function of its two arguments; the test pins `shouldPoll(false,"ready") === true`** |
| T8 | no tests (components); rationale recorded in the plan's File Structure section — agrees |
| T9 | tests pin `normalizeSheet` and `fillTemplate` behaviour — agrees |

### Rulings on the scan

Ruling (Conflict A): `CURRENT_TERM` gains a fifth key, `"status": str | None`, carrying `"active"`
or `"closed"`, written everywhere the other four are written (create_term, unlock, `_apply_snapshot`)
— why: the guard runs on every write request and must not make a database query to learn the status;
the spec's ข้อ 14 requires the server to actually refuse, and without this key `term_blocks_write`
reads `None`, returns `None`, and the guard silently permits every write to a closed term, which is
the exact failure the spec names — cost if wrong: one extra key in the snapshot, ignored by older
backups.

Ruling (Conflict B): `_term_entity_index()` returns `{"teachers": set(), "rooms": set(), "subjects": set()}`
whenever it cannot read terms for any reason — no database, unreadable blob, missing key — and never
raises — why: its only caller is the delete guard, and a guard that raises turns "cannot check" into
"cannot delete anything", breaking ordinary teacher management on a server with no database; failing
open here is safe because with no closed terms there is nothing to protect — cost if wrong: on a
database outage a delete that should be refused is allowed; the term file still holds its own copy of
the teacher, so the archive stays readable either way.

Ruling (Conflict C): `shouldPoll(viewingClosed, dataState)` returns `false` when `viewingClosed` is
true, otherwise `dataState === "ready"`. The store ANDs this with its own remaining conditions rather
than moving them into the function — why: it makes the function pure and the plan's two assertions
exact, and keeps the store's existing polling logic untouched — cost if wrong: the store polls in a
state it used not to; caught by the existing recovery path.

## Progress
Task 1: dispatched (implementer agent a64a1c62418bbc640, sonnet) BASE=74510bc
Briefs 1–9 extracted to this workspace.

Ruling: stood up a throwaway PostgreSQL 16.15 at /tmp/pgtest (port 55432, unix socket, trust auth,
started as the unprivileged `postgres` user) purely to verify SQL by hand — why: psycopg cannot be
installed (PyPI DNS also fails), so the Python layer cannot reach a database here, but `psql` can,
and the backend tasks are almost entirely SQL that would otherwise ship unverified — cost if wrong:
none; it is a scratch cluster in /tmp holding only fake rows, and it never touches the school's data.

Task 1: implementer returned DONE_WITH_CONCERNS (commit 3c6a55e). Verified two of its concerns myself
against the real Postgres: the `CASE WHEN %s = 'closed'` parameter reuse is correct in both INSERT and
UPDATE and in both directions, and `UNIQUE (year, semester)` refuses duplicates. Confirmed the third
concern is real by experiment: two rows with status='active' were accepted.
Task 1: fix round 1/5 dispatched (resumed a64a1c62418bbc640) — 3 findings:
  (1) Critical: literal "X" placeholder left in the comment above _TERMS_SCHEMA.
  (2) Important: no constraint prevents two active terms — hand-verified fix is a partial unique
      index `app_terms_one_active ON app_terms (status) WHERE status = 'active'` (creates, idempotent
      on re-run, refuses a second active row, allows many closed rows — all tested on 16.15).
  (3) Important: `status` unvalidated in _term_insert/_term_set_status; a "Closed" typo would make
      Task 3's guard treat a closed term as writable.
Task 1: fix round 1/5 (3 addressed, 0 open; commits 3c6a55e..85191c5). Implementer's "X" placeholder
  came from its own sed-based mutation check overwriting the comment — it now mutates on a copy.
Task 1: coordinator re-verified wiring — all 5 db functions call the new `_terms_schema(cur)` helper
  (mock_api.py 13634/13645/13655/13667/13682), no caller left executing the table DDL alone, and the
  table+index DDL pair is idempotent across 3 consecutive runs on real Postgres 16.15 (NOTICE+skip,
  exit 0, all three indexes present). Suite: ผ่าน 7 · ไม่ผ่าน 0.
Task 1: task review dispatched (a2b2ca00fab284f86, sonnet) over 74510bc..85191c5.
Task 1: review — spec ✅, quality: 7 Minor, no Critical/Important.
Task 1: ⚠️ cannot-verify items resolved by coordinator, both NOT gaps:
  · `_STORE_KIND = "postgres"` is set only after `_db_read()` has already succeeded in `_load_state`;
    any failure sets it to `"file"`. So "postgres" does imply a connection that worked at startup.
  · `_db_connect` is three lines (`import psycopg; return psycopg.connect(_DB_URL, connect_timeout=15)`)
    and logs nothing.
Task 1: minor (deferred): comment above _TERMS_SCHEMA contradicts itself on whether the active term
  has a row in app_terms — Task 2 settles this (it will insert one), so fix the wording then or at final review.
Task 1: minor (deferred): swallowed exception in list_terms gives the operator nothing, not even the
  exception class name; a dead DB and a blip look identical.
Task 1: minor (deferred): the Thai "ยังไม่ได้ต่อฐานข้อมูล จึงใช้ระบบเทอมไม่ได้" string is duplicated
  (mock_api.py ~80 and ~160) — should be one constant.
Task 1: minor (deferred): no success-path test for list_terms / _term_dict column mapping (checked by
  eye, correct); a fake-cursor test would pin r[0..8] against _TERM_COLUMNS.
Task 1: minor (deferred): schema column test matches padded whitespace, so re-aligning the DDL breaks it.
Task 1: minor (deferred): one test resets _STORE_KIND to "file" instead of restoring the saved value,
  so it depends on test order.
Task 1: minor (deferred): test_every_term_function_uses_schema_helper matches source text via inspect
  — weak but honest wiring guard.
Task 1: complete (commits 74510bc..85191c5, spec ✅, 0 Critical/Important, 7 minors deferred)
Task 2: dispatched BASE=85191c5
Task 2: implementer DONE_WITH_CONCERNS (f2b5d06) and caught a real defect in MY plan.
Ruling: the plan's step 5 for create_term (insert a closed copy of the current term) is wrong and is
replaced by the implementer's `_term_rotate` — UPDATE the running term's existing row to closed with
its final snapshot, then INSERT the new active row, in one transaction — why: the running term's row
already holds its (year, semester), so inserting a second copy violates UNIQUE (year, semester) from
the school's SECOND term onward; the first term would have worked and the failure would have appeared
months later, at the worst possible moment. Verified on real Postgres 16.15: first term, two
consecutive rotations, and rollback safety (a forced duplicate INSERT rolled the UPDATE back and left
the old term active with its original blob) — cost if wrong: none found; this is strictly more correct
than the plan.
Ruling: the term ROW is authoritative for `id` and `status`; the stored blob's `current_term` is not.
The new row's id cannot exist before RETURNING id, so re-packing the blob would cost a second ~300 KB
write per term for nothing — why: one cheap rule beats an expensive round trip, and Task 4 enforces it
by overwriting `current_term` from the row before returning a term file — cost if wrong: a future
feature that trusts the blob reads a null id; mitigated by docstring, comment, and a Task 4 test.
Ruling: `create_term` also clears `PARKED`, but NOT `ABSENCES`, `SUBSTITUTIONS`, `REPAYMENTS` or
`YARD_PICKS` — why: the spec says the new term's timetable starts empty and parked lessons are
timetable work-in-progress pointing at last term's plan, whereas the สอนแทน records are the school's
log of who covered whom and who owes a period back; the spec never asked for those to be deleted and
deleting records on my own authority is not reversible — cost if wrong: last term's สอนแทน rows stay
visible in a new term (they carry dates, so they read as last term's). OPEN QUESTION FOR THE USER.
Task 2: fix round 1/5 dispatched (resumed a1d65c9f10549b561) — 4 Important + 1 Minor:
  blob says "active" for a closed row; row-wins rule to be documented; PARKED not cleared;
  _STORE_ERROR unchecked after the transition; Task 1's self-contradicting comment (now settled).
Task 2: fix round 1/5 (5 addressed, 0 open; commits f2b5d06..9f57929)
Task 2: review — spec ✅, quality: 3 Important, 4 Minor.
Ruling: extending the row-wins rule — the term ROW is authoritative for WHICH TERM IS ACTIVE, not just
for id and status. `create_term` must SELECT the row with status='active' and close that row, using
CURRENT_TERM only as a cross-check — why: restoring a pre-today backup blanks CURRENT_TERM while the
database still holds an active row; create_term then skips the close, its INSERT hits the one-active
index, and the button is wedged forever behind a "try again" message that never works — cost if wrong:
one extra SELECT per term creation, a few times a year.
Ruling: `save_error` is kept but made truthful — `_flush_pending(blocking=True)` runs AFTER
_save_state() so the transition is durable before the response, and the field carries a fixed Thai
sentence instead of f"{type}: {exc}" — why: _save_state only queues, so the old code reported the
PREVIOUS flush's error; and the pending window left app_state holding the old term as active while
app_terms said it was closed, so a crash there reloads a contradiction. The interpolation could also
echo DSN text, and the DSN is a password — cost if wrong: one blocking write on a button pressed a
few times a year.
Task 2: minor (deferred): uncaught _flush_pending re-raise (:211) and post-commit _term_row() (:251)
  both yield FastAPI's English 500 in a Thai app.
Task 2: minor (deferred): no lock around the clear-and-rotate window — a concurrent edit landing during
  the database round trip goes into the emptied list. Task 3's write guard does NOT cover this window,
  because the term is still active while it happens.
Task 2: minor (deferred): test_create_term_rejects_bad_year_and_semester leaves _STORE_KIND="postgres".
Task 2: minor (deferred): that same brief-mandated assertion is loose ("400" in repr(exc) or ...), but
  a strict test beside it covers the same ground.
Task 2: fix round 2/5 dispatched (resumed a1d65c9f10549b561) — 3 Important.
OPEN QUESTION raised with the user: whether creating a new term should also clear ABSENCES /
SUBSTITUTIONS / REPAYMENTS. Current behaviour keeps them. User told; no answer needed to proceed.
Task 2: fix round 2/5 (2 addressed, 1 open + 1 new Critical; commits 9f57929..699b49c)
  F1 status trap ADDRESSED · F2 wedge ADDRESSED · F3 save_error NOT ADDRESSED
  New Critical: the post-save _flush_pending(blocking=True) at :13840 is uncaught and re-raises AFTER
  the rotate commits, so a database blip there shows FastAPI's English 500 saying the term was not
  created when it was — the exact case the save_error field exists to avoid.
Ruling: do not build a second durability mechanism for the create-term response. Wrap the post-save
flush, report `save_error` (fixed Thai sentence) plus `save_pending` from `_pending_blob is not None`,
and leave the authoritative "is my work saved" answer to GET /api/state/version, which already reports
pending/saved_at/store_error and which the frontend already polls every 3.5s to draw its save chip —
why: `_flush_pending(blocking=True)` returns immediately when the writer thread has already taken the
blob, so it cannot honestly promise durability, and a wait-for-quiet loop would be a second mechanism
to keep in step with the first — cost if wrong: Task 8 must watch the save chip rather than trust the
create response; recorded for Task 8's dispatch.
Task 2: fix round 3/5 dispatched (resumed a1d65c9f10549b561) — 1 Critical, 1 Important, 1 Minor.
Task 2: fix round 3/5 (3 addressed, 0 open; commits 699b49c..848b1d7) — Critical closed, save_error
  now honest (fixed Thai sentence + save_pending), leak test verified to catch a real DSN leak.
Task 2: minor (deferred): the post-save `except Exception` drops the exception without logging, so a
  programming error inside _flush_pending's own fallback is invisible except via save_error.
Task 2: minor (deferred): the new flush-raises test never resets _STORE_ERROR, so a stale value from
  an earlier test could make save_error truthy for the wrong reason (the test still catches a revert).
Task 2: complete (commits 85191c5..848b1d7, spec ✅, 0 Critical/Important, 6 minors deferred)
Task 3: dispatched BASE=848b1d7
NOTE for Task 8: a create-term response with save_error=None and save_pending=True is NOT proof the
  term is saved — the save chip fed by GET /api/state/version is the authoritative answer.
Task 3: implementer DONE_WITH_CONCERNS (67eccb9) and caught a real one: _bump_revision is the OUTERMOST
  middleware, so a response returned before call_next never passes through CORSMiddleware and arrives
  with no Access-Control-Allow-Origin. Frontend is GitHub Pages, backend is Render, so every request is
  cross-origin — the browser would have hidden the Thai 409 behind a generic network error.
Ruling: set `Access-Control-Allow-Origin: *` by hand on the guard's 409, with a comment saying why —
  rather than reordering middleware or mirroring the request Origin — why: CORS here is configured
  `allow_origins=["*"]` (mock_api.py:56), so the literal `*` is the complete and correct value, and a
  hand-rolled allowlist would be a second copy of the CORS policy to drift from the first; reordering
  add_middleware is forbidden by the plan's constraints and would move GZip/CORS relative to the
  revision counter — cost if wrong: none identified; it is the same value CORSMiddleware would add.
Ruling: keep `/api/terms/` as a prefix in TERM_WRITE_SAFE_PATHS rather than listing each term route —
  why: unlocking a term is itself a POST and must work from a closed state, and an explicit list would
  silently lock out the next term endpoint someone adds — cost if wrong: a future write route under
  /api/terms/ is exempt while a term is closed; mitigated by a comment requiring anything added there
  to be safe to call on a closed term.
Task 3: fix round 1/5 dispatched (resumed a9572dc9f9f1d3230) — 1 Important, 1 Minor.
Task 3: implementer added tests/stubs/fastapi/responses.py (stub JSONResponse) — the real file has no
  fastapi.responses stub; needed because the guard returns a response object directly.
Task 3: fix round 1/5 (2 addressed, 0 open; commits 67eccb9..0979a8d) — CORS header on the 409, prefix
  trade-off documented, stub JSONResponse keeps headers, test pins the header.
Task 3: review — spec ✅, quality Approved with 2 Minor, one of which the reviewer explicitly handed
  back to me to decide.
Ruling: the write guard FAILS CLOSED — anything that is not None and not exactly "active" blocks, in
place of the previous "not exactly 'closed' means writable" — why: the asymmetry is decisive. A wrong
block is loud, immediate and recoverable (Thai message, user unlocks the term); a wrong allow is silent
and corrupts a term the school believes is sealed, which is the exact failure the spec names. Permitting
a write should require a value we recognise, not refusing one — cost if wrong: a status value nobody
anticipated blocks writes until someone looks, which is the direction we want to be wrong in.
Ruling: the 409 message uses term.get("label") with a Thai fallback — why: term['label'] raises KeyError
inside middleware, which FastAPI turns into an English 500, so the one response whose job is to explain
itself in Thai would fail in English — cost if wrong: none.
Task 3: fix round 2/5 dispatched (resumed a9572dc9f9f1d3230) — 2 Minor, both ruled on above.
Task 3: fix round 2/5 (2 addressed, 0 open; commits 0979a8d..a339cc2) — guard fails closed, Thai
  fallback label; both reverts proven to fail their tests.
Task 3: minor (deferred): a term dict with no "status" KEY at all reads as None and permits writes.
  CURRENT_TERM always has the key (Task 2 defines five) and _apply_snapshot sets it, so this is
  theoretical — but requiring the key to be present would be stricter.
Task 3: complete (commits 848b1d7..a339cc2, spec ✅, 0 Critical/Important, 3 minors deferred)
Task 4: dispatched BASE=a339cc2
Task 4: implementer DONE_WITH_CONCERNS (0f540b5). Used a sibling `_term_swap_active` rather than
  reusing `_term_rotate` (rotate inserts; swap must leave the requested row's data untouched) and
  extracted `_flush_after_term_change` shared by create and unlock.
Task 4: coordinator verified `_term_swap_active` on real Postgres 16.15 under both unique constraints:
  closes the active row with its final blob, activates the requested row, leaves the unlocked row's
  stored data exactly as it was; a missing row and an already-active row both give UPDATE 0 so the
  rowcount check fires and the rollback leaves exactly one active term. The school is never left with
  zero active terms.
Ruling: GET /api/terms/{id}/data REFUSES the active term with a Thai 409, rather than documenting that
callers should not ask — why: the active term's row holds a stale blob (live data lives in memory and
app_state), so serving it would show last rotation's timetable as if it were current, with nothing on
screen saying so; Tasks 7 and 8 are yet to be written and a convention only has to be broken once,
whereas an endpoint that cannot be asked the dangerous question cannot be misused — cost if wrong: the
browser must reload live data to leave the viewer instead of re-fetching the active term, which is what
Task 7 does anyway.
Task 4: fix round 1/5 dispatched (resumed ad00fa01b87ae844c) — 1 Important.
Task 4: minor (deferred): unlock mutates memory before the commit and restores on failure, so another
  request could observe the unlocked term for a few ms — same window as create_term. Both are now
  behind `_flush_after_term_change`, so one lock fixes both.
Task 4: fix round 1/5 (1 addressed, 0 open; commits 0f540b5..a1893b3)
Task 4: review — spec ✅, quality: 4 Minor, no Critical/Important. Reviewer's failure walk confirms the
  database can never hold zero or two active terms, and that unlock saves the running term's work into
  its own row before closing it.
Task 4: minor (deferred): after the swap commits, _term_row() and _save_state() in the return path are
  unwrapped — a database drop right after the commit shows a 500 for an unlock that succeeded, and the
  retry then says "เทอมนี้ไม่ได้ปิดอยู่". create_term shares this. Data is safe; the message misleads.
Task 4: minor (deferred): the log detail's active_row.get('label') is only exercised through its id
  fallback, because the fake _term_active returns {"id": ...} without a label.
Task 4: minor (deferred): test_term_data_endpoint_does_not_touch_server_state runs with
  _STORE_KIND="file" so _require_db raises first and it asserts nothing — redundant now.
Task 4: minor (deferred): _apply_snapshot merges school_config with .update(), so a rollback cannot
  remove keys the unlocked term's config added (cosmetic; the keys come from that row's own config).
Task 4: complete (commits a339cc2..a1893b3, spec ✅, 0 Critical/Important, 4 minors deferred)
Tasks 5+6: BATCHED into one dispatch BASE=a1893b3 — both are small, independent, and the same shape
  (walk every closed term blob, compute, expose one endpoint plus one pure function). Reviewed as one unit.
Tasks 5+6: fix round 1/5 (2 addressed; commits f510f00,da90e9c..432bf8b) — by_teacher/by_department now
  dedup shared lessons via _shared_lesson_key; `active` coerced to a real boolean.
Ruling: by_teacher and by_department count a shared lesson ONCE, via the existing _shared_lesson_key
(mock_api.py:816) — why: that helper's own docstring says anything counting a teacher's hours must know
this "or it bills her for ten hours she did not work"; a ลูกเสือ block runs in 14 classrooms with the
same supervisors on all 14 cells, so the raw count would show a supervisor with 14× the periods she
taught, and comparing a teacher's load across terms is the headline use of this screen. `slots` stays a
plain count of filled cells — cost if wrong: by_department summed can be less than slots, which is
documented in the docstring.
Ruling: the delete guard checks periods only, and the gap is deliberate — why: each term's snapshot
carries its OWN teachers/rooms/groups lists, so viewing or printing an archived term resolves every name
from that snapshot, not the live registry. A live delete therefore cannot corrupt an archive, which
means the guard is a policy protection (keeping archive↔registry links resolvable for per-teacher
statistics), not corruption prevention. This CORRECTS the spec's claim that "ตารางเทอมเก่าจะพัง" —
cost if wrong: a teacher named only in an archived term's requirements, elective pools, homeroom or
reserved_teacher_ids can still be deleted; the archive still renders correctly.
Ruling: _coerce_active rejects an unparseable value ("abc", a list) with a Thai 400 rather than
defaulting — why: silently defaulting could retire a teacher or un-retire one, and a bad value is a
client bug worth surfacing — cost if wrong: a client sending junk gets an error instead of a guess.
Tasks 5+6: review — spec ✅, quality Approved with 3 Minor.
Tasks 5+6: fix round 2/5 (1 addressed, 0 open; commits 432bf8b..0925484) — bulk create is now
  all-or-nothing; re-review ADDRESSED, no new breakage.
Tasks 5+6: minor (deferred): the ACT: shared key carries no day/period, so an activity split across two
  different times counts once for a supervisor who teaches it twice. Comes from the shared helper that
  every other teacher-hour count in the program uses; changing it here would make the statistics
  disagree with the workload sheet and the clash detector. Known limitation of the shared key.
Tasks 5+6: minor (deferred): free-period activity blocks (is_free_period) count like lessons in `slots`,
  in the per-teacher counts and in the delete guard. Neither brief asked to exclude them.
Tasks 5+6: minor (deferred): the all-or-nothing test restores the live list after its assertions rather
  than in a `finally`, so a non-HTTPException from the endpoint would leak rows into later tests.
Task 5: complete (commit f510f00 + fixes, spec ✅, 0 Critical/Important)
Task 6: complete (commit da90e9c + fixes, spec ✅, 0 Critical/Important)

=== CHECKPOINT: server side (Tasks 1-6) complete and reviewed. Tasks 7-9 are the browser side. ===
Reason to checkpoint here rather than continue: Tasks 7-9 are the only ones whose plan-specified
verification (`npm run lint`, `tsc --noEmit -p tsconfig.json`) CANNOT run in this container — DNS for
registry.npmjs.org and pypi.org both fail, so node_modules cannot be installed and the npm cache is
incomplete. Tasks 1-6 were fully verifiable (python tests + a real Postgres 16.15 I stood up for SQL).
Shipping three unverifiable UI tasks unattended into a live school app is worse than doing them with
the toolchain working. Nothing is pushed; branch `term-layer` holds everything.

=== RESUMED: user asked for Tasks 7-9 to be finished (CI lint accepted as the backstop) ===
Ruling: the "cannot typecheck" limitation is narrower than I thought — `tsc` IS installed globally at
/home/claude/.npm-global/bin/tsc, so TypeScript can be checked without node_modules. Two checks now in
use: (a) a pure module on its own, --strict with its imports stubbed so they RESOLVE — a clean, real
verdict; (b) the whole frontend/src with --noResolve, compared against a main baseline of 9964 errors
captured in /tmp/tsbase, where the signal is the DELTA and any error code not in the baseline. Both were
proven able to fail by injecting `const x: number = "nope"` and watching the count rise and fall. What
still cannot run is `npm run lint` (eslint needs its plugins) and `npm run build`.
Task 7: implementer DONE_WITH_CONCERNS (7550855). Coordinator typecheck: utils/terms.ts CLEAN under
  --strict with imports resolved; whole tree 9977 vs 9964 baseline, +13 all TS7006 axios-callback noise,
  NO new error codes. Suite ผ่าน 9 · ไม่ผ่าน 0 (ts/terms.ts adds 28 assertions).
Ruling: concerns 2, 3 and 6 are one problem with one fix. Invariant stated once: while a closed term is
on screen, no live-data load may write into the store, and the banner must never be absent while archive
data is displayed — why: three separate guards for three symptoms drift apart, and every one of these
symptoms ends with the user looking at archive data that presents itself as current. Specifically:
(2) gate the REFRESH with the real dataState, not timer creation, so recovery keeps working and the
hard-coded "ready" disappears; (3) clear viewingTerm only after loadAll succeeds, keeping the banner and
a Thai message on failure; (6) decline the write at the point live data lands in the store, so future
callers are covered without remembering — the same argument that put the server write guard in one
middleware instead of 85 endpoints — cost if wrong: a refused store write while an archive is open,
which the banner already explains.
Task 7: fix round 1/5 dispatched (resumed a4dc4a5645d721019) — 3 concerns, one fix.
Task 7: noted for Task 8: the save-state chip stops updating while an archive is on screen (the poll is
  stopped by design). Task 8's banner should say so — a stalled chip with no explanation is not fine.
Task 7: fix round 1/5 (3 concerns addressed; commits 7550855..57a896f) — implementer enforced the
  invariant by wrapping zustand's `set` to strip 12 live-data keys while an archive is on screen.
Task 7: review — **spec ❌**, 1 Critical + 3 Important + 2 Minor. The set-wrapper instinct is right but
  its lifecycle has a hole and the gate is one level too low.
Task 7: coordinator found a finding the reviewer could not verify from the diff, and it is the worst one:
  the gate strips the local optimistic `set` but the outbound PATCH still goes to the server, and
  Task 3's guard does NOT refuse it — that guard reads CURRENT_TERM["status"], which is "active" while
  a browser views an archive. So dragging a lesson in archive view silently edits the LIVE timetable.
  The server guard is about which term the SERVER has open, not which term a BROWSER is looking at.
Ruling: the archive gate must block the edit ACTIONS, not only the state write, and must not rely on
Task 9 hiding controls — why: hidden controls are presentation; keyboard paths, drag handlers and
anything added later walk past them, and the failure is invisible (the UI shows nothing while the server
accepts the change) — cost if wrong: an edit attempt during archive view becomes a no-op the user may
not expect; the banner explains why.
Ruling: closeViewing should be made ATOMIC (gather everything, apply once) rather than fixing its
failure message — why: the current message claims the archive is still shown while partial live data has
already overwritten it, and the screen is printable in that state; a truthful message about a mixed
screen is worse for the user than never producing the mix. Implementer may argue the other way with a
reason recorded.
Ruling: `schoolConfig` must be in the stripped-key set — why: it carries the director, deputy, term and
year that go onto every printed sheet, so without it printing an archived term stamps it with the CURRENT
term's name, which is exactly what spec test 17 forbids.
Task 7: fix round 2/5 dispatched (resumed a4dc4a5645d721019) — 1 Critical, 3 Important, 2 Minor.
Task 7: fix round 2/5 (1 Critical + 3 Important + 2 Minor addressed; commits 57a896f..fe0fdab).
Ruling (accepting the implementer's better alternative): the archive write gate lives in ONE axios
request interceptor in api/client.ts, not in the store actions as I instructed — why: the implementer
found that several edit paths bypass `withWrite` (the bulk-lock Promise.all, setYardPick,
updateSchoolConfig), so a store-level gate would have had holes by construction, while a transport-level
one cannot be walked past by a future caller — cost if wrong: it also blocks analysis-only POSTs while an
archive is open; blocked is the safe direction and the banner explains the mode.
Ruling: a term whose snapshot has no `periods` is REFUSED rather than drawn on the current period grid
— why: lessons would land in the wrong cells, and a printed sheet carries no banner to warn anyone.
Ruling: `closeViewing` is atomic — fetch all ten live sources, then apply once with the banner clear —
rather than keeping a truthful message about a mixed screen; `loadFailures`/`liveReloadComplete` were
removed as dead and loadAll is back to its original text.
Ruling: the interceptor must let the school-config write through, alongside /terms… — why: opening a
closed term in order to PRINT it is the primary use case in the spec, and the print form is what a
person reaches for while doing it; print settings and signature blocks are a school-wide preference, not
term data; and the dangerous part of that endpoint is already closed because Task 2 made
update_school_config ignore `term`/`year` once a term exists — cost if wrong: a config change made while
viewing an archive applies school-wide, which is what the school wants from a preference.
Task 7: coordinator typecheck after round 2 — whole tree 9949 vs 9964 baseline, NO new error codes;
  utils/terms.ts isolated --strict CLEAN; 66 assertions.
Task 7: fix round 3/5 dispatched (resumed a4dc4a5645d721019) — 1 Important.
Task 7: three type points the implementer could not verify (no resolvable axios) and handed over, for
  the review to settle: Promise.reject from a request interceptor in this axios version; spreading
  school_config into a valid SchoolConfig; fetchLiveBundle inferring a tuple.
Task 7: fix round 3/5 (1 addressed; commit fe0fdab..d259654) — interceptor allowed PUT /school/config.
Task 7: re-review of rounds 2+3 — findings 1,3,4,5,6 ADDRESSED; finding 2 PARTLY (second axios client
  ungated); two NEW Important + 3 Minor.
Ruling (REVERSING my own round-3 ruling): remove the PUT /school/config exception from the archive write
gate — why: I missed that every print-form setter does an optimistic set({schoolConfig}), and
schoolConfig is a stripped live key, so the allowance produced the worst state of all — the PUT reached
the server and changed the live config while the screen never updated and typed text snapped back. The
alternative, letting the config setters hold the token so their writes land, puts a door in the gate that
loads could imitate ("this write declared itself intentional"), and the gate's whole value is having no
such door. The spec requires that every printed sheet of a closed term WORKS, not that the form can be
edited while one is open; the form can be set before opening the archive or after leaving — cost if
wrong: a person who wants to adjust the print form for an archived term must leave the term, adjust, and
reopen. Legible refusal beats a form that silently reverts.
Task 7: fix round 4/5 dispatched (resumed a4dc4a5645d721019) — 4 Important:
  (A) revert the /school/config allowance;
  (B) api/subClient.ts is a SECOND axios instance with no interceptor — its /sub/absences and
      /sub/substitutions writes still reach the live term while an archive is open;
  (C) the interceptor's Thai reason never reaches the screen — errorDetail only reads
      response.data.detail, so a drag in archive view shows "ย้ายไม่ได้ — ช่องนั้นไม่ว่าง", which is
      false: the cell is fine, the term is read-only;
  (D) closeViewing now requires fetchSchoolConfig to succeed where loadAll tolerated its failure, so a
      broken config endpoint would trap the user in the archive.
Task 7: minor (deferred): tryEnter returning null is a silent no-op — a second click during a request
  (up to 180 s) gives no feedback.
Task 7: minor (deferred): the allow-list startsWith("/terms/") would pass a contrived /terms/../x.
  /termsx and /school/config-evil are correctly refused.
Task 7: minor (deferred): BLANK_SCHOOL_CONFIG's schoolName "โรงเรียน" shows unmarked for an old snapshot
  with no school_config; term and year are always overwritten from the row so those never show.
Task 7: fix round 4/5 (4 Important addressed; commit d259654..da28660) — gate moved to api/writeGate.ts
  (no axios import, so testable), installed on BOTH axios instances, rejects with a WriteBlocked error
  whose Thai message now reaches the screen via errorDetail and moveRefusal, and closeViewing's config
  fetch fails soft.
Task 7: coordinator verified independently: exactly two axios.create calls in frontend/src (client.ts:15,
  subClient.ts:15), both gated; no bare fetch, XMLHttpRequest, sendBeacon, EventSource or WebSocket
  anywhere in frontend/src. Also settled all four type points (the generic C | Promise<never> fits
  axios's interceptor signature; the BLANK_SCHOOL_CONFIG spread is valid; Promise.all infers the tuple;
  the re-export is legal under isolatedModules because both names are values, not types).
Task 7: ⚠️ gate-scope item resolved by coordinator, NOT a gap — openTerm (timetableStore.ts:1084)
  refuses anything whose status !== "closed" with a Thai message, and the server 409s a request for the
  active term's blob. A viewed term is therefore always closed, so the gate trigger is sound.
Task 7: minor (deferred): three one-line wirings have no test of their own — the subClient interceptor
  install, the errorDetail/moveRefusal hooks, and the soft-failing config fetch. Reverting any of them
  leaves tests/ts/terms.ts green because the tests exercise the predicate and blockedReason directly.
  A revert of the subClient line would silently reopen the สอนแทน write hole.
Task 7: minor (deferred): closeViewing's config fallback can be stale if someone else edited the config
  while the archive was open, with no notice shown.
Task 7: complete (commits 0925484..da28660, spec ✅ after 4 fix rounds, 0 Critical/Important open)
Tasks 8+9: BATCHED into one dispatch BASE=da28660 — both are the screen layer built on Task 7's
  primitives, and Task 9's banner/print work shares files with Task 8's panels.
CARRIED INTO 8+9 as a requirement: seven components build their own catch text and so show
  "บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง" when the archive gate refuses — wrong advice, since trying again
  cannot work. Named by the re-review: Dashboard.tsx:918, ClearTimetableModal.tsx:94,
  PeriodCheckModal.tsx:71 and :88, RoomSettingsModal.tsx:88, LevelActivityPanel.tsx:202,
  ArrangeCover.tsx:123. They must route through blockedReason.
Tasks 8+9: implementer DONE_WITH_CONCERNS (80e8df8 Task 8, 3d3a5b1 Task 9). 182 + 65 assertions,
  suite ผ่าน 9 · ไม่ผ่าน 0, three pure modules clean under isolated --strict.
Tasks 8+9: coordinator typecheck CAUGHT A BUILD BREAKER the implementer could not see without
  node_modules — a NEW error code vs the baseline: SlotCell.tsx(317,7) TS2304 "Cannot find name
  'readOnly'". SlotCell declares and destructures readOnly but ends at line 112; line 317 is inside
  `Layer` (127–391), which never receives it. So the hover action buttons were never actually hidden in
  read-only mode AND the file does not compile. This is exactly what the baseline-delta check was for.
Ruling: drop "วิชาใหม่ที่ต้องสร้าง" and "ชุดคาบเสรีกี่ชุด" from the create-term preview screen rather
than adding them to the server — why: both describe a workload ROUND (subjects not yet in the registry,
and elective sets a department head filled in), which is Plan 2's data pushed by Plan 3. My plan text
carried them from the spec's section 8 without noticing they belong to the later flow. My error, not the
implementer's — cost if wrong: the screen shows five figures instead of seven until Plan 3; a comment
marks where the other two go.
Tasks 8+9: accepted without change — 13 further catch blocks routed through blockedReason (same class of
  fix, right to finish); a new `unlockOldTerm` store action mirroring makeNewTerm; and loadTerms() at
  startup, which is necessary because without it the ภาคเรียน/ปี fields never lock until someone opens
  the terms page, and a field that looks editable while the server ignores it is worse than a locked one.
  Also accepted: the create button stays locked after a timeout or 5xx and points at the terms list,
  because the term may already have been created.
Tasks 8+9: fix round 1/5 dispatched (resumed ad35161f2fbaa7d3b) — 1 Critical, 1 Important.
Tasks 8+9: fix round 1/5 (1 Critical + 1 Important addressed; commit 3d3a5b1..f4a7ea7) — readOnly now
  reaches Layer; TS2304 gone; no new error codes.
Tasks 8+9: review — **spec ❌**, 1 Critical + 2 Important + 4 Minor.
Tasks 8+9: SECOND build breaker, and the reviewer correctly identified why my check could not see it:
  pages/TimetablePage.tsx:49 renders <TimetableGrid /> with no props while readOnly is REQUIRED, and
  `build` runs `tsc && vite build` over all of src — so npm run build fails and the deploy breaks. My
  --noResolve delta misses it because TS2741 already exists in the baseline, so a new instance is not a
  new code. Lesson recorded: the baseline-delta check catches new error CLASSES, not new instances of
  classes already present; required-prop and missing-name codes need their own targeted grep.
Ruling: DELETE pages/TimetablePage.tsx rather than passing readOnly={false} or giving the prop a default
— why: the file is imported nowhere (verified by grep), so passing a value keeps a dead file alive and
makes it read as a real second grid call site, which is exactly what made the implementer's report claim
there was one; and defaulting the prop to false is worse, because a future call site that forgets it
would silently get EDIT MODE on an archived term, the precise bug this task exists to prevent. A required
prop with no default is the safe design — cost if wrong: if anyone wanted that page back it is one
`git revert` away.
Ruling: printTermName must return undefined when the viewed term has no label, never fall back to the
active term's label — why: that fallback IS spec test 17's failure, an archived sheet printed under the
current term's name; printing no term name is honest, printing the wrong one is not. Reviewer filed it
Minor; promoted — cost if wrong: a sheet with a blank term field.
Tasks 8+9: fix round 2/5 dispatched (resumed ad35161f2fbaa7d3b) — 1 Critical, 3 Important.
Tasks 8+9: minor (deferred): createOutcome's "info" tone is green in NewTermModal though its text only
  asks the user to watch the save chip.
Tasks 8+9: minor (deferred): unlockOldTerm throws when the unlock succeeds but leaving the archive fails;
  the dialog then resets its latch and a retry hits 409 with a confusing message.
Tasks 8+9: noted — TermMeta.slots for the ACTIVE term is the value stored in its row at creation or last
  rotation, so it is not live. Reloading the list gets a fresher row but the active count is only exact
  at rotation.

=== 7 พ.ย. — ตัวช่วยที่ลงมือ (sonnet) ชนเพดานการใช้งานรายห้าชั่วโมงกลางรอบแก้ที่ 2 ของ task 8+9 ===
Ruling: coordinator ตรวจและ commit งานที่ค้างใน working tree ให้เอง แทนที่จะรอ 13 ชั่วโมงให้โควตารีเซ็ต
— why: ตัวช่วยแก้ไฟล์ไว้ครบทั้งสี่ข้อแล้วแต่ตายก่อน commit และก่อนรันตรวจอะไรเลย; การป้องกันที่สำคัญคือ
"มีคนอื่นตรวจ" ไม่ใช่ "ใครพิมพ์" จึงยังส่งรีวิวแยกตามปกติ และ coordinator ไม่ได้เขียนโค้ดเพิ่มเอง แค่
ตรวจ import/ชนิดข้อมูล/เทส แล้ว commit — cost if wrong: diff ของรอบนั้นไม่ได้ผ่านตาผู้ลงมือซ้ำ จึงส่ง
scoped re-review ทันที (ผ่านครบสี่ข้อ)
Tasks 8+9: fix round 2/5 (1 Critical + 3 Important; commit f4a7ea7..b1b1d8a) — ลบไฟล์ตายที่ทำให้
  build พัง, printTermName ไม่ถอยไปใช้ชื่อเทอมที่ใช้งาน, ปุ่ม TopNavbar กดไม่ได้ + ปิดโหมดทั้งสี่,
  หน้าต่างปลดล็อกโหลดจำนวนคาบใหม่. re-review: ADDRESSED ทั้งสี่.
Tasks 8+9: re-review ยืนยันว่าลายเซ็นตัวห่อ set กว้างพอ (ไม่มีจุดไหนส่ง replace flag; TS2322 สองตัวมา
  จาก axios ที่ --noResolve แก้ชนิดไม่ได้ ไม่ใช่จากตัวห่อ) — ตรงกับที่ coordinator วิเคราะห์เอง
Tasks 8+9: ⚠️ unverified จาก re-review: หน้าต่างที่เปิดค้างไว้ก่อนเข้าเทอมเก่า (showRepair, showBalance,
  showPropose, showPlan, SolverWidget) ไม่ถูกปิดตอน readOnly พลิก จึงยังมีปุ่มเขียนที่กดได้ —
  ด่าน transport ยังปฏิเสธจริง จึงเป็นเรื่อง UI หลอกตา ไม่ใช่ข้อมูลหาย → ฝากรอบตรวจรวม
NEW HOLE found by coordinator: ตัวห่อ set อ้างว่าเป็นด่านเดียว แต่คอมโพเนนต์เรียก
  useTimetableStore.setState ตรง ๆ — ตอนแรกนับได้ 9 จุด (grep ของผมถูก head ตัด) จริงคือ 54 จุด
  ใน ~14 ไฟล์ โดย Dashboard.tsx มีราว 35 จุด หลายจุดเขียนคีย์ที่ด่านต้องกัน
Ruling: แปลง setState ตรง ๆ **ทุกจุด** เป็น action `patch` ที่เขียนผ่านตัวห่อ ไม่ใช่เลือกเฉพาะจุดเสี่ยง
— why: จุดที่ปลอดภัยอยู่แล้วคือแบบ `await api.createX()` แล้วค่อย setState (ด่านปฏิเสธ POST, await โยน,
setState ไม่ทำงาน) แต่แบบ optimistic-แล้ว-rollback (Dashboard.tsx:849/853) และแบบ
`setState({ x: await api.fetchX() })` (GET ซึ่งด่าน**อนุญาต**) เขียนลงร้านจริง; การแยกแยะ 54 จุดช้าและ
พลาดง่ายกว่าการแปลงหมด และ**ไม่มีจุดไหนที่การข้ามด่านเป็นสิ่งที่ต้องการ** — คีย์ที่ไม่ได้กัน
(savePointState, viewingError ฯลฯ) ผ่าน patch ไปเฉย ๆ — cost if wrong: 54 จุดแก้แบบกลไก ตรวจด้วย
grep ที่ต้องเหลือศูนย์ และ this.setState ของ ErrorBoundary ต้องเหลือหนึ่ง
Tasks 8+9: sweep committed (3383c40 nine sites + patch action, 92827f3 the remaining 45).
  Acceptance met: `useTimetableStore.setState` = 0 in frontend/src · `this.setState` = 1 (ErrorBoundary)
  · suite ผ่าน 9 · ไม่ผ่าน 0.
Tasks 8+9: coordinator typecheck, every delta accounted for and PROVEN an artifact, not a defect:
  · TS2304 / TS2741 / TS2739 / TS2551 — all 0 on both branch and baseline.
  · TS2339 branch 87 vs baseline 86. The one extra is `Property 'DEV' does not exist on type
    'ImportMetaEnv'` (timetableStore.ts, the dev-only console.warn). Proven artifact with a probe:
    frontend/src/vite-env.d.ts declares its own ImportMetaEnv AND has
    `/// <reference types="vite/client" />`; TypeScript interface MERGING adds vite/client's DEV to the
    project's two fields. Probe with vite/client's declaration present → CLEAN; without it → exactly
    this error. So it compiles in a real build.
  · TS2322 branch 7 vs baseline 5. Both extras are the same line,
    `loadFresh(() => api.fetchSlots(), (slots) => set({ slots }), writeGuard)`. main has the identical
    line with no error because its `set` is zustand's, which is `any` under --noResolve, while the
    branch's `set` is an explicitly typed local function so it is actually checked. `fetchSlots` is
    declared `Promise<TimetableSlot[]>`, so `slots` is only `unknown` because axios cannot resolve.
Tasks 8+9: minor (deferred): surfaces opened BEFORE entering archive view (showRepair, showBalance,
  showPropose, showPlan, SolverWidget) are not closed when readOnly flips, so their write buttons stay
  live. The transport gate refuses the request, so this is misleading UI, not data loss.
Tasks 8+9: minor (deferred): if the unlock dialog's refresh fails, the old period count stays with no
  notice; `termsReason` is set but the dialog does not show it.
Task 8: complete (commit 80e8df8 + fixes, spec ✅ after 2 fix rounds)
Task 9: complete (commit 3d3a5b1 + fixes, spec ✅ after 2 fix rounds)

=== ALL 9 TASKS COMPLETE — proceeding to the final whole-branch review ===

=== FINAL WHOLE-BRANCH REVIEW (opus) — verdict: DO NOT MERGE, one blocking defect ===
BLOCKER: on the live server app_terms is EMPTY (no term row has ever been created), so the FIRST press
of "create new term" deletes all ~2,700 placed periods and archives them nowhere. create_term
(mock_api.py:14099-14122) finds no active row → has_old=False → _term_rotate (:13847) issues no closing
UPDATE → but SLOTS.clear()/PARKED.clear() (:14114-14115) run UNCONDITIONALLY. Reviewer probed it with a
fake cursor and 2,700 slots: SLOTS 2700→0, zero UPDATEs, one INSERT (new active row, slots=0),
closed: None. The save history is no refuge either — its newest row after the call is the EMPTIED blob,
because the history-keeping cliff rule (:13593) fires exactly on a large drop in period count. Spec
tests 11 and 17 both fail on first use, and the UI promises the opposite (utils/terms.ts:326-329 still
says the running term "จะถูกปิดและแก้ไม่ได้อีก" when active === null). unlock_term (:14373-14390) has
the same shape, narrower. Two tests locked the broken behaviour in, because they were written to match
what was built rather than what should be.
ROOT CAUSE — my own ruling: "the row is authoritative for which term is active" reasoned about a
RESTORED BACKUP blanking memory while a row exists, and never about NO ROW HAVING EVER EXISTED, which is
the live server's state today. "Nothing to close" quietly became "clear anyway". The reviewer named this
and it is correct.
Fix dispatched (a30305baedd6eba15, opus): _term_rotate gets an old_id-is-None branch that INSERTs the
running term as a closed row in the same transaction, year/semester from CURRENT_TERM or else from
SCHOOL_CONFIG["term"]/["year"] (strings, need converting); refuse with a Thai 409 BEFORE any clearing on
collision or when year/semester cannot be determined; same protection for unlock_term; and the two
locking tests rewritten.
Final review also flagged, agreed and recorded:
  · Ruling audit: the สอนแทน half of the PARKED ruling is right for the right reason, but YARD_PICKS was
    bundled in with no reason stated — the outcome is defensible (a yard pick is a hand-made decision
    taken BEFORE the timetable, i.e. an input like the teaching plans) and that reason should be written
    down, or the silence reads as an oversight.
  · The whole-tree --noResolve baseline check is WEAK evidence and must not be the closing argument:
    it catches new error CLASSES, not new instances, and two build breakers slipped past it. The real
    gate is a green CI `npm run build` on push.
  · Worth a ticket, not a blocker: GET /api/terms/stats (:14261) unpacks every closed blob on every
    request, uncached — fine at 2 terms, a latency and memory problem at 20.
  · Add the one assertion that subClient.ts installs gateRequest: reverting that line silently reopens
    the สอนแทน write hole and nothing fails.
  · Not real: the /terms/../x traversal (no caller builds it; axios does not normalize, the browser does,
    and it 404s server-side) and the _apply_snapshot .update() merge.
  · All ~25 other deferred minors: fine to defer. None blocks merge.
Blocker fix committed (dfe2417, opus). Added `_nothing_a_term_change_would_destroy()` as a deliberate
  deviation: skip the archive and the 409s when SLOTS and PARKED are both empty, so a fresh install
  configured for 1/2568 can still create term 1/2568 and no empty closed row squats on a (year,semester).
  Coordinator verified the premise directly: create_term clears ONLY those two lists and restores exactly
  those two on failure.
Final re-review (opus) — **verdict: SAFE TO MERGE.** Traced every path from entering create_term to an
  empty SLOTS and confirmed a closed row holding those periods commits first in all of them, including
  the archive-INSERT, new-INSERT, commit, pack and blocking-save failure paths; and confirmed every
  refusal sits above the first mutation (create_term refuses at :14207/14209/14217/14222/14232 and
  :14242-14244, first mutation :14258; unlock_term refuses at :14501-14544, first mutation :14562).
Ruling (accepting the final re-review's split): KEEP the _nothing_a_term_change_would_destroy() clause
in create_term, REMOVE it in unlock_term — why: the helper's premise ("only two lists are at stake") is
true in create_term but false in unlock_term, which calls _apply_snapshot and replaces fifteen
collections plus GROUPS, SCHOOL_CONFIG and CURRENT_TERM. A school mid-setup — teachers, rooms, plans and
curricula entered, no periods placed yet — has both lists empty while an unlock would overwrite all of
that with nothing archived. "No periods" is not "nothing to lose" on that path, and refusing an unlock
is always safe — cost if wrong: an unlock is refused in a case where it could have proceeded.
Final fixes committed (5dcefc0): clause removed at unlock_term with a Thai comment saying the asymmetry
  is deliberate, and isdigit() → isdecimal() so a superscript digit in the configured year gives the
  Thai 409 instead of a bare 500. Both new tests verified failing before the edit.

=== BRANCH COMPLETE. 29 commits. Suite ผ่าน 9 · ไม่ผ่าน 0. Final review: safe to merge. NOT PUSHED. ===
Remaining before the school uses it: CI must go green on `npm run build` and `npm run lint`, which could
not run here; and the by-hand list in the final review must be worked through, starting with pressing
"create new term" on a COPY of the production database and confirming the old term's row holds the same
period count.

=== POST-BRANCH (7 พ.ย.) — closing the two gaps named above ===

Gap 1 — CI could not run here (npm registry unreachable from this sandbox: ENOTFOUND
registry.npmjs.org, host in the proxy's noProxy list, and the npm cache was too incomplete for
--offline). Ruling: do not keep trying to make npm work locally; move the verification to GitHub
Actions, where the registry is reachable and the packages are real — why: `npm run build` is
`tsc && vite build` with fully resolved imports, which is strictly stronger than the
baseline-delta typecheck I could do here (that method already missed TS2741 at
TimetablePage.tsx:49 once, because the code was in the main baseline) — cost if wrong: a CI
workflow file lands in the repo that nobody needs later.
  Added .github/workflows/check.yml: lint + build + tests, `branches-ignore: [main]`,
  `permissions: contents: read`, NO deploy step. Run 42360846619 failed only at my tests step
  (Node 20 cannot execute .ts) while Lint ✓ and Build ✓ both passed; fixed in 45d7c47 by keeping
  Node 20 for lint/build (mirroring deploy.yml) and adding Node 22 immediately before the tests.
  Run 42361008414: completed success. GAP CLOSED — lint, tsc+vite build and all 9 test files are
  green on real packages.

Gap 2 — the user needs to SEE the system, under the constraint "จะไม่กระทบกับงานตารางสอน
เพราะตอนนี้ตารางสอนยังไม่นิ่ง". Ruling: publish the branch to a SEPARATE URL
(/school-scheduler/preview/) rather than merging to main — why: merging replaces the site the
teachers are actively using while the timetable is unsettled, and a revert is only fast if someone
is watching; a second link leaves the known-good site in place and lets exactly one careful person
look at the new one — cost if wrong: an unused preview/ directory on the gh-pages branch.
  Added .github/workflows/preview.yml (c943ac9). Three independent reasons it cannot touch the
  live site: `branches: [term-layer]` (a push to main does not match), `destination_dir: preview`
  (writes confined to that subdirectory), `keep_files: true` (skips the action's delete step
  entirely, so nothing already on gh-pages can be removed). `workflow_dispatch` was tried first
  and rejected: GitHub only dispatches a workflow present on the default branch, and pushing the
  file to main would itself have fired deploy.yml.
  NOT a sandbox: the preview build points at the SAME Render backend and the SAME database
  (VITE_API_URL, the same secret deploy.yml uses). Written into the workflow's header comment so
  the next reader cannot miss it.

Ruling on the open สอนแทน question (does "create new term" clear ABSENCES / SUBSTITUTIONS /
REPAYMENTS?): KEEP the current behaviour — they carry over into the new term — and report it
rather than change it unasked. Why: the records are inside the archived snapshot either way, so
neither choice loses data; keeping is the no-code-change option, and carried-over records are
visible and deletable by hand, whereas clearing them when the school wanted a pending คาบใช้คืน
to follow the teacher into the new term needs an archive restore to undo. This only matters at
the moment the button is pressed, which should not happen until it has been tried on a copy of the
production database — cost if wrong: the first new term opens showing last term's absence records,
and the school deletes them by hand or asks for a one-line change.

STILL OUTSTANDING (unchanged): the by-hand list from the final review, led by pressing
"สร้างเทอมใหม่" on a COPY of the production database. I cannot do this — I have no access to the
live database, by the user's standing instruction.
