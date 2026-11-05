import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";
import { loadBackend } from "./api";
import { OS_NOW } from "./lib/platform";
import { localStore, migrateStorage } from "./lib/storage";
import { initTheme } from "./useTheme";

const root = createRoot(document.getElementById("root") as HTMLElement);

migrateStorage(localStore());
// The header leaves room for macOS's traffic lights; elsewhere the window has its own title bar.
document.documentElement.dataset.os = OS_NOW;

loadBackend().then(({ backend, mock }) => {
  if (mock) document.documentElement.dataset.mock = "1";
  void initTheme(backend);
  root.render(
    <React.StrictMode>
      <App backend={backend} />
    </React.StrictMode>,
  );
});
