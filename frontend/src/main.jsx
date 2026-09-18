import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return <main><h1>Smart Cold Chain IoT</h1><p>Dashboard frontend đang ở giai đoạn khung; API backend sẵn sàng tại <code>http://localhost:3000</code>.</p></main>;
}

createRoot(document.getElementById("root")).render(<App />);
