import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { warmUpFonts } from "./utils/fonts";

// ดึงฟอนต์มาเตรียมไว้ก่อน เพื่อให้หน้าตัวอย่างพิมพ์ได้ฟอนต์ตัวจริงตั้งแต่แรก
warmUpFonts();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
