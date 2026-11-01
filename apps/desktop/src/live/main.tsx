import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "../styles.css";
import { LiveWindow } from "./LiveWindow";
import { isDesktop } from "../recorder";
import { startRecording } from "../recording/session";

// The floating recorder's own page (live.html): follows the system light/dark setting.
const mq = window.matchMedia("(prefers-color-scheme: light)");
const apply = () => (document.documentElement.dataset.theme = mq.matches ? "light" : "dark");
apply();
mq.addEventListener("change", apply);

// Opened in a browser (pnpm dev:ui, /live.html): show the pill with a simulated recording.
if (!isDesktop) void startRecording("Preview", null, true);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LiveWindow />
  </React.StrictMode>,
);
