import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import App from "./App";
import { DemoBanner, IS_DEMO } from "./demo";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {IS_DEMO ? (
      <div className="flex h-full flex-col">
        <DemoBanner />
        <div className="min-h-0 flex-1">
          <App />
        </div>
      </div>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
