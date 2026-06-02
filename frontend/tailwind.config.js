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
      fontFamily: {
        sans: ["Inter", "Sarabun", "sans-serif"],
        thai: ["Sarabun", "sans-serif"],
      },
    },
  },
  plugins: [],
};
