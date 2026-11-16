const FONT_FAMILIES = ["Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", "sans-serif"];

// สีทุกตัวอ้างตัวแปรใน :root ของ src/index.css (ค่าจริงอยู่ที่นั่นที่เดียว) — คลาสเช่น bg-brand text-muted border-line bg-warn-soft
// ข้อแลก: ใส่ /50 ท้ายสีแบบนี้ไม่ได้ (tailwind ผสมความโปร่งกับ var() ไม่ได้) ใช้ opacity-* แทน
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: FONT_FAMILIES,
        thai: FONT_FAMILIES,
      },
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        line: "var(--line)",
        line2: "var(--line2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        brand: { DEFAULT: "var(--brand)", strong: "var(--brand-strong)", soft: "var(--brand-soft)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)", faint: "var(--warn-faint)", bar: "var(--warn-bar)" },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)", bar: "var(--ok-bar)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
        bad: { DEFAULT: "var(--bad)", soft: "var(--bad-soft)" },
      },
      // แบบข้อ 6: หัวข้อหน้า 26px หนา · ตัวเลขสรุป 28px
      fontSize: {
        title: ["26px", { lineHeight: "1.3", fontWeight: "700" }],
        stat: ["28px", { lineHeight: "1.2", fontWeight: "700" }],
      },
      borderRadius: {
        card: "14px",
      },
      maxWidth: {
        page: "1240px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(43, 42, 38, 0.04)",
      },
    },
  },
  plugins: [],
};
