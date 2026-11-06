/**
 * ให้ node หาไฟล์ .ts เจอจากการนำเข้าที่ไม่มีนามสกุล
 *
 * โค้ดของแอปเขียน `import { x } from "./teacherSlots"` ซึ่ง Vite หาให้เองได้
 * แต่ node ต้องการนามสกุลเป๊ะ ๆ ถ้าไม่มีตัวนี้ ตัวทดสอบจะนำเข้าโมดูลจริงไม่ได้
 * เลย และจะเหลือทางเลือกแค่คัดลอกโค้ดมาทดสอบ ซึ่งไม่ได้ทดสอบอะไร
 */
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try { return await next(specifier + ext, context); } catch { /* ลองอันถัดไป */ }
    }
  }
  return next(specifier, context);
}
