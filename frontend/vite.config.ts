/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One entry: index.html is what Wails embeds and boots.
// Unit tests cover the pure modules only (notes, captions, exp scaling, config
// reducers, the mock simulator). No jsdom, no component rendering.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
