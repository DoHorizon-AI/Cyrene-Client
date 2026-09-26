import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TeamGate } from "./team/TeamGate";
import { LocaleProvider } from "./i18n";
import "./styles.css";
import "./services/settings.css";
import "./ide/ide.css";

createRoot(document.getElementById("root")!).render(<StrictMode><LocaleProvider><TeamGate><App /></TeamGate></LocaleProvider></StrictMode>);
