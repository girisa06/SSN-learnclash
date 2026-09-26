import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true lets a phone / second laptop on the same Wi-Fi open the dev server.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
