import { Link, useLocation } from "react-router-dom";

import { currentMode } from "../lib/appMode";
import { artIcon } from "../lib/art";

/** Gear in the top-right corner of page headers; opens the settings page.
 * Hidden on the settings page itself. */
function SettingsButton() {
  const { pathname } = useLocation();
  if (pathname === "/settings") return null;
  return (
    <Link
      to="/settings"
      aria-label="Impostazioni"
      className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full transition active:scale-95"
    >
      <img
        src={artIcon(currentMode(pathname), "gear")}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-7 w-7"
      />
    </Link>
  );
}

export default SettingsButton;
