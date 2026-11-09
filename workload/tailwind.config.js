const FONT_FAMILIES = ["Sarabun", "Noto Sans Thai", "Leelawadee UI", "Tahoma", "sans-serif"];

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: FONT_FAMILIES,
        thai: FONT_FAMILIES,
      },
    },
  },
  plugins: [],
};
