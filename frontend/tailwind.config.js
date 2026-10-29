// สำเนาของ FONT_FAMILIES ใน src/utils/fonts.ts (ไฟล์นี้เป็น js จึง import ไม่ได้)
// ถ้าแก้ที่นั่นต้องแก้ที่นี่ด้วย — มีตัวทดสอบคอยจับว่าสองที่ตรงกัน
const FONT_FAMILIES = ["Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", "sans-serif"];

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        outdoor: { DEFAULT: "#fbbf24", light: "#fef3c7", border: "#f59e0b" },
        heavy: { DEFAULT: "#6366f1", light: "#eef2ff" },
        parallel: { DEFAULT: "#10b981", light: "#ecfdf5" },
        locked: { DEFAULT: "#64748b", light: "#f1f5f9" },
      },
      // ต้องตรงกับ FONT_FAMILIES ใน src/utils/fonts.ts
      fontFamily: {
        sans: FONT_FAMILIES,
        thai: FONT_FAMILIES,
      },
    },
  },
  plugins: [],
};
