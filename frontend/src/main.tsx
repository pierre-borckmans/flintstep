import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";
import { loadBackend } from "./api";
import { localStore, migrateStorage } from "./lib/storage";
import { initTooltips } from "./ui/tooltip";
import { initTheme } from "./useTheme";

// Native `title` tooltips become styled ones app-wide (see ui/tooltip).
initTooltips();

const root = createRoot(document.getElementById("root") as HTMLElement);

migrateStorage(localStore());

loadBackend().then(({ backend, mock }) => {
  if (mock) document.documentElement.dataset.mock = "1";
  void initTheme(backend);
  root.render(
    <React.StrictMode>
      <App backend={backend} />
    </React.StrictMode>,
  );
});
