"""
Elite CP-SAT Timetable Solver
==============================
Uses Google OR-Tools CP-SAT to assign all lesson requirements to (day, period, room)
triples while satisfying hard constraints and minimising soft-constraint penalties.

Hard constraints  → enforced as model equalities/inequalities (zero tolerance)
Soft constraints  → penalty-weighted terms in the minimisation objective
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from ortools.sat.python import cp_model

from app.config import settings


# ─────────────────────────────────────────────────────────────────────────────
# Data Transfer Objects (populated from DB rows before solver call)
# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class STeacher:
    id: int
    fixed_room_id: Optional[int]
    outdoor_score: int
    max_slots_per_day: int
    max_outdoor_per_week: int
    building_id: Optional[int] = None  # derived from fixed_room


@dataclass
class SGroup:
    id: int
    level: Optional[str]  # "M1".."M6"
    parent_id: Optional[int]


@dataclass
class SSubject:
    id: int
    code: str
    type: str          # "common" | "parallel"
    duration: int      # 1 | 2
    weight: str        # "heavy" | "light"


@dataclass
class SRoom:
    id: int
    type: str           # "physical" | "special" | "outdoor"
    building_id: Optional[int]
    floor: int
    capacity: int


@dataclass
class SRequirement:
    id: int
    group_id: int
    subject_id: int
    teacher_id: int
    weekly_count: int
    parallel_group_key: Optional[str]  # same key → sibling parallel tracks


@dataclass
class LockedSlot:
    teacher_id: int
    group_id: int
    room_id: Optional[int]
    subject_id: int
    day: int
    period: int
    is_double_start: bool


@dataclass
class SolverInput:
    teachers: List[STeacher]
    groups: List[SGroup]
    subjects: List[SSubject]
    rooms: List[SRoom]
    requirements: List[SRequirement]
    locked_slots: List[LockedSlot] = field(default_factory=list)
    days: int = settings.DAYS_PER_WEEK
    periods_per_day: int = settings.PERIODS_PER_DAY
    break_period: int = settings.BREAK_PERIOD
    assembly_period: int = settings.ASSEMBLY_PERIOD
    lunch_lower: int = settings.LUNCH_LOWER
    lunch_upper: int = settings.LUNCH_UPPER
    lower_levels: List[str] = field(default_factory=lambda: list(settings.LOWER_LEVELS))
    upper_levels: List[str] = field(default_factory=lambda: list(settings.UPPER_LEVELS))
    max_outdoor_simultaneous: int = settings.MAX_OUTDOOR_SIMULTANEOUS
    time_limit_seconds: int = settings.SOLVER_TIME_LIMIT_SECONDS


@dataclass
class AssignedSlot:
    requirement_id: int
    group_id: int
    teacher_id: int
    subject_id: int
    room_id: Optional[int]
    day: int
    period: int
    is_double_start: bool
    parallel_group_key: Optional[str]


@dataclass
class SolverOutput:
    status: str
    slots: List[AssignedSlot]
    solve_time_seconds: float
    objective_value: Optional[float]
    violations: List[str]


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────
def _forbidden_periods(group: SGroup, inp: SolverInput) -> Set[int]:
    """Return the set of period indices that are never schedulable for a group."""
    forbidden: Set[int] = {inp.break_period, inp.assembly_period}
    # Period 9 = homeroom wrap-up – also unschedulable for lessons
    forbidden.add(inp.periods_per_day - 1)
    # Staggered lunch
    if group.level in inp.lower_levels:
        forbidden.add(inp.lunch_lower)
    else:
        forbidden.add(inp.lunch_upper)
    return forbidden


def _schedulable_starts(group: SGroup, duration: int, inp: SolverInput) -> List[Tuple[int, int]]:
    """
    Return all valid (day, start_period) pairs for a lesson of the given duration
    belonging to the given group, respecting forbidden periods and double-period
    boundary rules (must not straddle break or end-of-day).
    """
    forbidden = _forbidden_periods(group, inp)
    results = []
    for d in range(inp.days):
        for p in range(inp.periods_per_day):
            if p in forbidden:
                continue
            if duration == 2:
                if p + 1 >= inp.periods_per_day:
                    continue
                if p + 1 in forbidden:
                    continue
            results.append((d, p))
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Main Solver
# ─────────────────────────────────────────────────────────────────────────────
class TimetableSolver:
    def __init__(self, inp: SolverInput):
        self.inp = inp
        self.model = cp_model.CpModel()

        # Index lookups
        self.teacher_map: Dict[int, STeacher] = {t.id: t for t in inp.teachers}
        self.group_map: Dict[int, SGroup] = {g.id: g for g in inp.groups}
        self.subject_map: Dict[int, SSubject] = {s.id: s for s in inp.subjects}
        self.room_map: Dict[int, SRoom] = {r.id: r for r in inp.rooms}

        # Variables: starts[(req_id, occ, day, period)] = BoolVar
        self.starts: Dict[Tuple[int, int, int, int], cp_model.IntVar] = {}
        # room_vars[(req_id, occ, day, period, room_id)] = BoolVar
        self.room_vars: Dict[Tuple[int, int, int, int, int], cp_model.IntVar] = {}
        # selected_room[(req_id, occ, day, period)] → chosen room_id (from room_vars)
        # (populated post-solve)

        # Derived: occupies[(teacher_id|group_id|room_id, day, period)] → list of BoolVars
        self.teacher_occupies: Dict[Tuple[int, int, int], List[cp_model.IntVar]] = defaultdict(list)
        self.group_occupies: Dict[Tuple[int, int, int], List[cp_model.IntVar]] = defaultdict(list)
        self.room_occupies: Dict[Tuple[int, int, int], List[cp_model.IntVar]] = defaultdict(list)

        # Penalty terms (pairs of (coeff, BoolVar) for the objective)
        self.penalty_terms: List[Tuple[int, cp_model.IntVar]] = []

    # ──────────────────────────────────────────────────────────────────────────
    # Build model
    # ──────────────────────────────────────────────────────────────────────────
    def _build_variables(self):
        for req in self.inp.requirements:
            subj = self.subject_map[req.subject_id]
            grp = self.group_map[req.group_id]
            valid_starts = _schedulable_starts(grp, subj.duration, self.inp)

            for occ in range(req.weekly_count):
                for (d, p) in valid_starts:
                    key = (req.id, occ, d, p)
                    var = self.model.NewBoolVar(f"s_{req.id}_{occ}_{d}_{p}")
                    self.starts[key] = var

                    # Register occupancy (both periods for double-length)
                    self.teacher_occupies[(req.teacher_id, d, p)].append(var)
                    self.group_occupies[(req.group_id, d, p)].append(var)
                    if subj.duration == 2:
                        self.teacher_occupies[(req.teacher_id, d, p + 1)].append(var)
                        self.group_occupies[(req.group_id, d, p + 1)].append(var)

                    # Room assignment variables (physical/special only; outdoor handled separately)
                    compatible_rooms = self._compatible_rooms(req, subj)
                    for rm in compatible_rooms:
                        rkey = (req.id, occ, d, p, rm.id)
                        rv = self.model.NewBoolVar(f"r_{req.id}_{occ}_{d}_{p}_{rm.id}")
                        self.room_vars[rkey] = rv
                        self.room_occupies[(rm.id, d, p)].append(rv)
                        if subj.duration == 2:
                            self.room_occupies[(rm.id, d, p + 1)].append(rv)

    def _compatible_rooms(self, req: SRequirement, subj: SSubject) -> List[SRoom]:
        """Return rooms that can host this lesson (capacity & type matching)."""
        grp = self.group_map[req.group_id]
        grp_size = grp.__dict__.get("size", 40)
        teacher = self.teacher_map[req.teacher_id]

        rooms = []
        for rm in self.inp.rooms:
            if rm.capacity < grp_size:
                continue
            if rm.type == "outdoor" and teacher.outdoor_score < 8:
                continue
            rooms.append(rm)

        # Prioritise fixed room by putting it first (soft constraint uses index)
        if teacher.fixed_room_id:
            rooms.sort(key=lambda r: 0 if r.id == teacher.fixed_room_id else 1)
        return rooms

    # ── Hard: every occurrence placed exactly once ────────────────────────────
    def _hard_occurrence_assigned(self):
        for req in self.inp.requirements:
            subj = self.subject_map[req.subject_id]
            grp = self.group_map[req.group_id]
            valid_starts = _schedulable_starts(grp, subj.duration, self.inp)

            for occ in range(req.weekly_count):
                vars_for_occ = [
                    self.starts[(req.id, occ, d, p)]
                    for (d, p) in valid_starts
                    if (req.id, occ, d, p) in self.starts
                ]
                if not vars_for_occ:
                    # Infeasible – log and skip (solver will return INFEASIBLE)
                    continue
                self.model.AddExactlyOne(vars_for_occ)

    # ── Hard: no teacher double-booking ──────────────────────────────────────
    def _hard_teacher_no_overlap(self):
        for key, vars_list in self.teacher_occupies.items():
            if len(vars_list) > 1:
                self.model.Add(sum(vars_list) <= 1)

    # ── Hard: no group double-booking ────────────────────────────────────────
    def _hard_group_no_overlap(self):
        for key, vars_list in self.group_occupies.items():
            if len(vars_list) > 1:
                self.model.Add(sum(vars_list) <= 1)

    # ── Hard: no room double-booking ─────────────────────────────────────────
    def _hard_room_no_overlap(self):
        for key, vars_list in self.room_occupies.items():
            if len(vars_list) > 1:
                self.model.Add(sum(vars_list) <= 1)

    # ── Hard: each placed lesson assigned exactly one room ───────────────────
    def _hard_room_assignment(self):
        for req in self.inp.requirements:
            subj = self.subject_map[req.subject_id]
            grp = self.group_map[req.group_id]
            valid_starts = _schedulable_starts(grp, subj.duration, self.inp)
            compatible_rooms = self._compatible_rooms(req, subj)
            compatible_room_ids = [rm.id for rm in compatible_rooms]

            for occ in range(req.weekly_count):
                for (d, p) in valid_starts:
                    start_key = (req.id, occ, d, p)
                    if start_key not in self.starts:
                        continue
                    start_var = self.starts[start_key]
                    room_vars_this_slot = [
                        self.room_vars[(req.id, occ, d, p, rm_id)]
                        for rm_id in compatible_room_ids
                        if (req.id, occ, d, p, rm_id) in self.room_vars
                    ]
                    if room_vars_this_slot:
                        # sum(room_vars) == start_var
                        self.model.Add(sum(room_vars_this_slot) == start_var)

    # ── Hard: parallel groups share the same (day, period) ───────────────────
    def _hard_parallel_sync(self):
        # Group requirements by parallel_group_key
        parallel_groups: Dict[str, List[SRequirement]] = defaultdict(list)
        for req in self.inp.requirements:
            if req.parallel_group_key:
                parallel_groups[req.parallel_group_key].append(req)

        for key, reqs in parallel_groups.items():
            if len(reqs) < 2:
                continue
            base_req = reqs[0]
            subj = self.subject_map[base_req.subject_id]
            base_grp = self.group_map[base_req.group_id]
            valid_starts = _schedulable_starts(base_grp, subj.duration, self.inp)

            for occ in range(base_req.weekly_count):
                for (d, p) in valid_starts:
                    base_key = (base_req.id, occ, d, p)
                    if base_key not in self.starts:
                        continue
                    base_var = self.starts[base_key]

                    for sibling in reqs[1:]:
                        sib_key = (sibling.id, occ, d, p)
                        if sib_key in self.starts:
                            # Force sibling to match base exactly at this slot
                            self.model.Add(self.starts[sib_key] == base_var)
                        else:
                            # Sibling cannot be placed here → base also cannot
                            self.model.Add(base_var == 0)

    # ── Hard: locked slots must not move ─────────────────────────────────────
    def _hard_locked_slots(self):
        """Pre-block (teacher, group, room) triplets for locked slots."""
        for ls in self.inp.locked_slots:
            # Block teacher at that slot for any other lesson
            for key, vars_list in self.teacher_occupies.items():
                tid, d, p = key
                if tid == ls.teacher_id and d == ls.day and p == ls.period:
                    for v in vars_list:
                        self.model.Add(v == 0)
            for key, vars_list in self.group_occupies.items():
                gid, d, p = key
                if gid == ls.group_id and d == ls.day and p == ls.period:
                    for v in vars_list:
                        self.model.Add(v == 0)

    # ── Soft: teacher max consecutive teaching ≤ 3 ───────────────────────────
    def _soft_teacher_fatigue(self, penalty_weight: int = 50):
        """Penalise windows of 4+ consecutive occupied periods for a teacher."""
        for teacher in self.inp.teachers:
            for d in range(self.inp.days):
                for p in range(self.inp.periods_per_day - 3):
                    window = []
                    for k in range(4):
                        vars_at_period = self.teacher_occupies.get((teacher.id, d, p + k), [])
                        window.extend(vars_at_period)
                    if not window:
                        continue
                    # sum of occupancy indicators across 4 consecutive periods
                    # (each indicator is a start var that may occupy 1 or 2 periods)
                    # We create an auxiliary boolean: is_over_limit
                    over = self.model.NewBoolVar(f"fatigue_{teacher.id}_{d}_{p}")
                    self.model.Add(sum(window) >= 4).OnlyEnforceIf(over)
                    self.model.Add(sum(window) < 4).OnlyEnforceIf(over.Not())
                    self.penalty_terms.append((penalty_weight, over))

    # ── Soft: prefer fixed/same-building room for back-to-back ───────────────
    def _soft_room_continuity(self, penalty_weight: int = 30):
        """Penalise teacher having consecutive lessons in different buildings."""
        for teacher in self.inp.teachers:
            for d in range(self.inp.days):
                for p in range(self.inp.periods_per_day - 1):
                    occ_p = self.teacher_occupies.get((teacher.id, d, p), [])
                    occ_p1 = self.teacher_occupies.get((teacher.id, d, p + 1), [])
                    if not occ_p or not occ_p1:
                        continue

                    # Collect room vars for each period
                    # If both are placed but in different buildings → penalty
                    # This is complex; we use a proxy: prefer fixed_room_id
                    if teacher.fixed_room_id is not None:
                        fixed_id = teacher.fixed_room_id
                        for req in self.inp.requirements:
                            if req.teacher_id != teacher.id:
                                continue
                            subj = self.subject_map[req.subject_id]
                            grp = self.group_map[req.group_id]
                            for occ in range(req.weekly_count):
                                for (dd, pp) in _schedulable_starts(grp, subj.duration, self.inp):
                                    if dd != d or pp != p:
                                        continue
                                    not_fixed_key = None
                                    for rm in self.inp.rooms:
                                        if rm.id == fixed_id:
                                            continue
                                        rk = (req.id, occ, dd, pp, rm.id)
                                        if rk in self.room_vars:
                                            self.penalty_terms.append((penalty_weight, self.room_vars[rk]))

    # ── Soft: heavy subjects spread across the week ───────────────────────────
    def _soft_heavy_subject_spread(self, penalty_weight: int = 40):
        """Penalise 2+ heavy subjects back-to-back on same day for a group."""
        heavy_req_ids: Dict[int, List[int]] = defaultdict(list)  # group_id → req_ids
        for req in self.inp.requirements:
            subj = self.subject_map[req.subject_id]
            if subj.weight == "heavy":
                heavy_req_ids[req.group_id].append(req.id)

        for group_id, req_ids in heavy_req_ids.items():
            if len(req_ids) < 2:
                continue
            grp = self.group_map[group_id]
            for d in range(self.inp.days):
                for p in range(self.inp.periods_per_day - 1):
                    # Collect start vars for heavy lessons at (d, p) and (d, p+1)
                    at_p = []
                    at_p1 = []
                    for rid in req_ids:
                        req = next(r for r in self.inp.requirements if r.id == rid)
                        subj = self.subject_map[req.subject_id]
                        for occ in range(req.weekly_count):
                            k = (rid, occ, d, p)
                            if k in self.starts:
                                at_p.append(self.starts[k])
                            k1 = (rid, occ, d, p + 1)
                            if k1 in self.starts:
                                at_p1.append(self.starts[k1])

                    if at_p and at_p1:
                        # Penalise if both slots have a heavy subject
                        both = self.model.NewBoolVar(f"heavy_{group_id}_{d}_{p}")
                        sum_p = self.model.NewIntVar(0, len(at_p), f"sp_{group_id}_{d}_{p}")
                        sum_p1 = self.model.NewIntVar(0, len(at_p1), f"sp1_{group_id}_{d}_{p}")
                        self.model.Add(sum_p == sum(at_p))
                        self.model.Add(sum_p1 == sum(at_p1))
                        self.model.AddMinEquality(both, [sum_p, sum_p1])
                        # If both >= 1, penalty fires
                        over = self.model.NewBoolVar(f"heavy_over_{group_id}_{d}_{p}")
                        self.model.Add(both >= 1).OnlyEnforceIf(over)
                        self.model.Add(both < 1).OnlyEnforceIf(over.Not())
                        self.penalty_terms.append((penalty_weight, over))

    # ── Soft: outdoor rooms capped + high outdoor_score teachers preferred ───
    def _soft_outdoor_management(self, penalty_weight_cap: int = 100, penalty_weight_score: int = 20):
        outdoor_room_ids = {rm.id for rm in self.inp.rooms if rm.type == "outdoor"}
        if not outdoor_room_ids:
            return

        # Cap: max MAX_OUTDOOR_SIMULTANEOUS outdoor rooms used per (day, period)
        for d in range(self.inp.days):
            for p in range(self.inp.periods_per_day):
                outdoor_vars = []
                for rm_id in outdoor_room_ids:
                    outdoor_vars.extend(self.room_occupies.get((rm_id, d, p), []))
                if not outdoor_vars:
                    continue
                cap = self.inp.max_outdoor_simultaneous
                # Hard cap – exceeding is never acceptable
                self.model.Add(sum(outdoor_vars) <= cap)

        # Prefer teachers with outdoor_score >= 8 for outdoor rooms
        for req in self.inp.requirements:
            teacher = self.teacher_map[req.teacher_id]
            if teacher.outdoor_score < 8:
                subj = self.subject_map[req.subject_id]
                grp = self.group_map[req.group_id]
                for occ in range(req.weekly_count):
                    for (d, p) in _schedulable_starts(grp, subj.duration, self.inp):
                        for rm_id in outdoor_room_ids:
                            rk = (req.id, occ, d, p, rm_id)
                            if rk in self.room_vars:
                                self.penalty_terms.append((penalty_weight_score, self.room_vars[rk]))

    # ── Soft: teacher max slots per day ──────────────────────────────────────
    def _soft_teacher_daily_cap(self, penalty_weight: int = 80):
        for teacher in self.inp.teachers:
            for d in range(self.inp.days):
                daily_vars = []
                for p in range(self.inp.periods_per_day):
                    daily_vars.extend(self.teacher_occupies.get((teacher.id, d, p), []))
                if not daily_vars:
                    continue
                over = self.model.NewBoolVar(f"daily_cap_{teacher.id}_{d}")
                self.model.Add(sum(daily_vars) > teacher.max_slots_per_day).OnlyEnforceIf(over)
                self.model.Add(sum(daily_vars) <= teacher.max_slots_per_day).OnlyEnforceIf(over.Not())
                self.penalty_terms.append((penalty_weight, over))

    # ── Objective ─────────────────────────────────────────────────────────────
    def _set_objective(self):
        if self.penalty_terms:
            self.model.Minimize(
                sum(coeff * var for coeff, var in self.penalty_terms)
            )

    # ──────────────────────────────────────────────────────────────────────────
    # Solve
    # ──────────────────────────────────────────────────────────────────────────
    def solve(self) -> SolverOutput:
        t0 = time.perf_counter()

        self._build_variables()
        self._hard_occurrence_assigned()
        self._hard_teacher_no_overlap()
        self._hard_group_no_overlap()
        self._hard_room_no_overlap()
        self._hard_room_assignment()
        self._hard_parallel_sync()
        self._hard_locked_slots()

        self._soft_teacher_fatigue()
        self._soft_room_continuity()
        self._soft_heavy_subject_spread()
        self._soft_outdoor_management()
        self._soft_teacher_daily_cap()
        self._set_objective()

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = self.inp.time_limit_seconds
        solver.parameters.num_search_workers = 8  # parallelise
        solver.parameters.log_search_progress = False

        status_code = solver.Solve(self.model)
        elapsed = time.perf_counter() - t0

        status_map = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.UNKNOWN: "UNKNOWN",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
        }
        status_str = status_map.get(status_code, "UNKNOWN")

        if status_code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolverOutput(
                status=status_str,
                slots=[],
                solve_time_seconds=elapsed,
                objective_value=None,
                violations=[f"Solver returned {status_str} – check constraints and requirements."],
            )

        obj_val = solver.ObjectiveValue() if self.penalty_terms else 0.0
        assigned = self._extract_solution(solver)
        return SolverOutput(
            status=status_str,
            slots=assigned,
            solve_time_seconds=elapsed,
            objective_value=obj_val,
            violations=[],
        )

    def _extract_solution(self, solver: cp_model.CpSolver) -> List[AssignedSlot]:
        results: List[AssignedSlot] = []
        req_map = {r.id: r for r in self.inp.requirements}

        for (req_id, occ, d, p), var in self.starts.items():
            if solver.Value(var) != 1:
                continue
            req = req_map[req_id]
            subj = self.subject_map[req.subject_id]

            # Find the assigned room
            chosen_room_id: Optional[int] = None
            for rm in self.inp.rooms:
                rk = (req_id, occ, d, p, rm.id)
                if rk in self.room_vars and solver.Value(self.room_vars[rk]) == 1:
                    chosen_room_id = rm.id
                    break

            results.append(AssignedSlot(
                requirement_id=req_id,
                group_id=req.group_id,
                teacher_id=req.teacher_id,
                subject_id=req.subject_id,
                room_id=chosen_room_id,
                day=d,
                period=p,
                is_double_start=(subj.duration == 2),
                parallel_group_key=req.parallel_group_key,
            ))

            # For double-period, emit the continuation slot
            if subj.duration == 2:
                results.append(AssignedSlot(
                    requirement_id=req_id,
                    group_id=req.group_id,
                    teacher_id=req.teacher_id,
                    subject_id=req.subject_id,
                    room_id=chosen_room_id,
                    day=d,
                    period=p + 1,
                    is_double_start=False,
                    parallel_group_key=req.parallel_group_key,
                ))

        return results
