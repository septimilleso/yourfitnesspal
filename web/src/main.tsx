import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { queryClient } from "./lib/queryClient";
import { prepareNativeSession } from "./native/boot";
import "./index.css";

// Nell'IPA il token e la cache vanno caricati prima del primo render, così la prima chiamata lo include
// e le schermate trovano i dati già ripristinati.
// Sul web prepareNativeSession non fa nulla e il render parte subito dopo.
prepareNativeSession(queryClient)
  .catch(() => undefined) // Senza sessione letta si mostra il login
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
