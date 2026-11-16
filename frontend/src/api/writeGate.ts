/**
 * ด่านขาออกของคำขอแก้ไข ตอนที่เบราว์เซอร์กำลังดูเทอมที่ปิดอยู่
 *
 * เซิร์ฟเวอร์ยังเปิดเทอมปัจจุบันอยู่และไม่รู้ว่าเบราว์เซอร์นี้ดูอะไร (ตัวเช็กฝั่ง
 * เซิร์ฟเวอร์อ่านเทอมที่เซิร์ฟเวอร์เปิด ซึ่งยัง active) คำขอแก้ไขใด ๆ จึงไปแก้ตาราง
 * จริงโดยจอไม่บอกอะไรเลย ตัดสินที่ transport ซึ่งทุกคำขอต้องผ่าน ไม่ใช่ที่ action
 * ของร้านทีละตัว เพราะเส้นแก้ไขหลายทางไม่ผ่านร้าน
 *
 * ไฟล์นี้ไม่ import axios — client.ts และ subClient.ts (สอง instance) เรียกฟังก์ชัน
 * เดียวกันนี้ และใช้ตัวตัดสินเดียวกัน (setWriteBlock) จึงมีกฎชุดเดียวจริง ๆ
 */
import { writeAllowedWhileViewing } from "../utils/terms";

/** คำขอถูกปฏิเสธเพราะกำลังดูเทอมที่ปิด — message คือข้อความไทยที่ผู้ใช้ควรเห็น */
export class WriteBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteBlocked";
  }
}

let writeBlock: (() => string | null) | null = null;

/** ร้านติดตัวตัดสินที่นี่ครั้งเดียว: คืนข้อความไทยเมื่อต้องกัน มิฉะนั้น null */
export const setWriteBlock = (fn: (() => string | null) | null): void => { writeBlock = fn; };

/** ใช้เป็น request interceptor ของทุก axios instance */
export function gateRequest<C extends { method?: string; url?: string }>(
  config: C,
): C | Promise<never> {
  if (writeAllowedWhileViewing(config.method ?? "get", config.url ?? "")) return config;
  const why = writeBlock ? writeBlock() : null;
  if (why) return Promise.reject(new WriteBlocked(why));
  return config;
}

/** ข้อความของด่านถ้า e มาจากด่านนี้ มิฉะนั้น null — เอาไปแสดงแทนข้อความสำรองของผู้เรียก */
export function blockedReason(e: unknown): string | null {
  return e instanceof WriteBlocked ? e.message : null;
}
