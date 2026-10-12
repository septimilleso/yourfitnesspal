import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { loadNativeSession } from "./native/session";
import "./index.css";

// Nell'IPA il token va caricato prima del primo render, così la prima chiamata lo include.
// Sul web loadNativeSession non fa nulla e il render parte subito dopo.
loadNativeSession()
  .catch(() => undefined) // Senza sessione letta si mostra il login
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
