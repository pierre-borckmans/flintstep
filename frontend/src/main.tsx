import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";
import { loadBackend } from "./api";

const root = createRoot(document.getElementById("root") as HTMLElement);

loadBackend().then(({ backend, mock }) => {
  if (mock) document.documentElement.dataset.mock = "1";
  root.render(
    <React.StrictMode>
      <App backend={backend} />
    </React.StrictMode>,
  );
});
