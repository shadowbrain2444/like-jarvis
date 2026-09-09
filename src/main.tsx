import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { attachActivityLog } from "./core/activityLog";
import "./styles/theme.css";
import "./ui/ui.css";

attachActivityLog();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
