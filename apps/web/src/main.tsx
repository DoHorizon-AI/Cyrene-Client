import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./services/settings.css";
import "./ide/ide.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
