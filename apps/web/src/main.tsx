import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerAppPwa } from "./app/registerPwa";

registerAppPwa();

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
