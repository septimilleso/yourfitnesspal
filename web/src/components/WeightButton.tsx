import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

import { modeFromPath } from "../lib/appMode";
import { artIcon } from "../lib/art";
import WeightOverlay from "./WeightOverlay";

function WeightButton() {
  const { pathname } = useLocation();
  const mode = modeFromPath(pathname);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const onClose = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  if (mode === null) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Registra peso"
        onClick={() => setOpen(true)}
        className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition active:scale-95"
      >
        <img src={artIcon(mode, "weight")} alt="" aria-hidden="true" draggable={false} className="h-7 w-7" />
      </button>
      {open && createPortal(<WeightOverlay mode={mode} onClose={onClose} />, document.body)}
    </>
  );
}

export default WeightButton;
