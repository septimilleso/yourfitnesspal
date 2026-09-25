import type { AppMode } from "../lib/appMode";
import { pattern, settingsScene } from "../lib/art";

/** Settings background: the section's cat illustration. Portrait fills the
 * screen anchored at the bottom. Landscape/desktop shows the whole
 * illustration as a centered column at full height over the section
 * pattern, with its left/right edges faded so there is no hard seam. */
function SettingsBackdrop({ mode }: { mode: AppMode }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${pattern(mode)}")` }}
      />
      <div
        data-testid="settings-scene"
        className="settings-scene absolute inset-0 bg-cover bg-bottom bg-no-repeat"
        style={{ backgroundImage: `url("${settingsScene(mode)}")` }}
      />
    </div>
  );
}

export default SettingsBackdrop;
