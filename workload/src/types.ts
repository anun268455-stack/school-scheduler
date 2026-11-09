import type { Teacher, Subject } from "../../frontend/src/types";

// นำเข้าแบบ import type เท่านั้น — ชนิดหายไปตอนคอมไพล์ ไม่ดึงโค้ดรันไทม์ของ frontend/ เข้ามาใน bundle
// เว็บนี้เป็นเจ้าของแค่ช่องตัวตนของครู/วิชา ส่วนช่องเงื่อนไขของเครื่องจัดคาบ (fixed_room_id, outdoor_score, max_* ฯลฯ)
// เป็นของเว็บตาราง · ใช้ Pick เพื่อให้ถ้าใครพิมพ์ช่องเหล่านั้นลงใน body ที่ส่งไป TypeScript ฟ้องทันที

/** ช่องตัวตนของครูที่เว็บนี้เป็นเจ้าของ — Pick จากชนิดของเว็บตาราง เพื่อให้สองฝั่งเพี้ยนกันเงียบ ๆ ไม่ได้ */
export type TeacherIdentity = Pick<Teacher, "name" | "code" | "department_id" | "dept_order">;
/** `id` = รหัสแถวของเว็บนี้ ไม่ใช่รหัสครูในเว็บตาราง (อันนั้นคือ `sched_id`) — สลับกันแล้วจะผูกครูผิดคน */
export type WlTeacher = TeacherIdentity & { id: number; sched_id: number | null; active: boolean };

export type SubjectIdentity = Pick<
  Subject,
  "code" | "name" | "type" | "department_id" | "duration" | "is_activity" | "is_elective"
>;
/** `id` = รหัสแถวของเว็บนี้ ไม่ใช่รหัสวิชาในเว็บตาราง (อันนั้นคือ `sched_id`) */
export type WlSubject = SubjectIdentity & { id: number; sched_id: number | null; active: boolean };

/** body ของ POST/PUT — มีแค่ช่องที่เว็บนี้เป็นเจ้าของ */
export type TeacherCreate = TeacherIdentity & { active?: boolean };
export type TeacherPatch = Partial<TeacherIdentity & { active: boolean }>;
export type SubjectCreate = SubjectIdentity & { active?: boolean };
export type SubjectPatch = Partial<SubjectIdentity & { active: boolean }>;

export type Department = { id: number; name: string };
export type ImportCounts = { created: number; linked: number; skipped: number };
