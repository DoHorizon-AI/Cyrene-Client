import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TeamGate } from "./team/TeamGate";
import "./styles.css";
import "./services/settings.css";
import "./ide/ide.css";

createRoot(document.getElementById("root")!).render(<StrictMode><TeamGate><App /></TeamGate></StrictMode>);
