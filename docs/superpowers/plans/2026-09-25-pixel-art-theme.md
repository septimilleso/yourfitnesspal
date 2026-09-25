# Pixel-art theme (cat mascots) — implementation plan

Goal: dress the web app in the user's pixel-art set (orange tabby cat: chef for Dieta,
headband + dumbbell for Palestra). Section backgrounds, tab-bar icons, mode-switch icons,
meal icons, empty-state mascots, login scene, and the installed-PWA icon.

## Global Constraints

- Source art lives outside the repo in `C:\Users\Simone Fenu.CONFARTIGIANATO\Pictures\app\{Dieta,Palestra}`.
  Copy it into the repo (task 1) so the pipeline is reproducible; never edit the originals.
- Generated files go to `web/public/art/` (and PWA icons to `web/public/`). Commit the generated
  files AND the script that makes them.
- Python 3 + Pillow 12 is available locally (`python`). No new npm dependencies.
- Web verification: from `web/`: `npm test`, `npm run build`, `npx eslint src` (if eslint is configured).
- UI copy stays Italian. Every decorative `<img>` gets `alt=""` (+ `aria-hidden`) unless it
  replaces text. Keep existing text labels (tabs, mode switch) so tests keep finding them.
- No dark mode exists in the app; do not add one.

### Source files (Dieta = D, Palestra = P; all names start `Immagine Codex 25 set 2026, `)

| file | content | repo name |
|---|---|---|
| D `08_39_09.png` | full-body chef cat, transparent | `web/art/dieta/mascot.png` |
| D `08_39_28.png` | app icon: chef cat on sage rounded square, transparent outside | `web/art/dieta/app-icon.png` |
| D `08_40_06.png` | icon sheet 4 cols x 3 rows, transparent | `web/art/dieta/icons.png` |
| D `08_40_20.png` | tall scene, cat bottom, empty cream top | `web/art/dieta/scene.png` |
| D `08_40_27.png` | tall cream pattern, food items around edges | `web/art/dieta/pattern.png` |
| P `08_40_41.png` | full-body gym cat, transparent | `web/art/palestra/mascot.png` |
| P `08_40_52.png` | app icon gym cat | `web/art/palestra/app-icon.png` |
| P `08_41_04.png` | icon sheet 4 x 3 | `web/art/palestra/icons.png` |
| P `08_41_24.png` | tall gym scene | `web/art/palestra/scene.png` |
| P `08_41_35.png` | tall cream pattern, gym items around edges | `web/art/palestra/pattern.png` |

Icon sheet order (row-major):
- Dieta: `cat, plate, cookbook, basket` / `egg, salad, soup, apple` / `water, chart, heart, gear`
- Palestra: `cat, clipboard, book, calendar` / `dumbbell, shoe, mat, moon` / `bottle, chart, medal, gear`

---

## Task 1 — Asset pipeline + PWA icon

Files: `web/art/**` (copied sources), `web/scripts/build-art.py` (new), `web/public/art/**`
(generated), `web/public/pwa-192x192.png`, `web/public/pwa-512x512.png`,
`web/public/pwa-maskable-512x512.png`, `web/public/apple-touch-icon.png`,
`web/public/favicon-32x32.png`, `web/vite.config.ts`, `web/index.html`; delete
`web/scripts/gen-icons.cjs` and `web/public/favicon.svg` if nothing else references them.

Steps:
1. Copy the 10 sources to `web/art/` under the names above.
2. Write `web/scripts/build-art.py` (run: `python scripts/build-art.py` from `web/`), idempotent:
   - **Icon slicing**: split each sheet into its 12 icons. Do not trust an exact grid: find the
     connected non-transparent blobs (or use grid cells as seeds and take the alpha bounding box
     inside each cell). The sheets have a bad-matting halo (red/yellow semi-transparent fringe
     outside the dark pixel outline): defringe by making alpha binary (alpha < 160 -> fully
     transparent, else opaque) and dropping any isolated specks smaller than ~30 px area. Trim,
     pad to a square with ~6% margin, resize with LANCZOS to 96x96 PNG.
     Output `public/art/diet/icons/<name>.png` and `public/art/gym/icons/<name>.png`.
   - **Mascots**: same defringe + trim, resize to 480 px tall, save as WebP (quality 85, keep alpha)
     `public/art/{diet,gym}/mascot.webp`.
   - **Backgrounds**: `pattern.png` and `scene.png` -> WebP quality 80, max width 941 (keep size),
     `public/art/{diet,gym}/{pattern,scene}.webp`. Each output must be well under 500 KB.
   - **PWA icon** (Dieta `app-icon.png` is THE installed-app icon): the rounded square sits on a
     transparent canvas with a noisy light halo around it. Find the rounded square (the sage-green
     body + its outline) and cut everything outside it to transparent; crop to its bounding box.
     - `public/pwa-192x192.png`, `public/pwa-512x512.png`: that crop, transparent corners, square.
     - `public/pwa-maskable-512x512.png` and `public/apple-touch-icon.png` (180x180): fully opaque.
       Sample the sage background colour from the icon; paint the full square with it, and place
       the icon content so the rounded-square corners disappear (e.g. crop the inner area inset
       from the rounded corners and scale it to fill). The cat's face must stay inside the
       central 80% circle (maskable safe zone).
     - `public/favicon-32x32.png` from the transparent version.
   - Print every output path with its size in KB.
3. Run the script. Open (Read) a sample of outputs to check visually: at least 3 icons per
   section composited on white, both pattern WebPs, all PWA icons. No coloured halo may remain
   around the icons; the PWA icon must have no grey/white noise in its corners.
4. `vite.config.ts`: manifest `icons` = 192 + 512 (`purpose: "any"`) + maskable 512
   (`purpose: "maskable"`); `theme_color` and `background_color` -> the cream `#fdf7e8`;
   `includeAssets` -> the new favicon + apple-touch-icon; workbox `globPatterns`
   `["**/*.{js,css,html,png,webp,svg,ico}"]` so the art is available offline.
5. `index.html`: `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">`,
   `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, theme-color metas -> `#fdf7e8`.
6. Remove `scripts/gen-icons.cjs` and `public/favicon.svg` (grep for references first).
7. `npm run build` must pass; check the generated `dist/manifest.webmanifest`.
8. Commit: `feat(web): pixel-art asset pipeline and cat PWA icon`

## Task 2 — Theme the UI with the art

Files: `web/tailwind.config.js`, `web/src/index.css`, `web/src/components/AppShell.tsx`,
`web/src/components/ModeSwitch.tsx`, `web/src/components/MealSection.tsx`,
`web/src/pages/LoginPage.tsx`, `web/src/pages/gym/HistoryPage.tsx`,
`web/src/pages/gym/GymStartPage.tsx`, `web/src/pages/SearchPage.tsx`,
`web/src/components/gym/ExerciseList.tsx`, new `web/src/lib/art.ts`, plus tests next to the
existing ones (`*.test.tsx`).

Steps:
1. `src/lib/art.ts`: typed helpers returning public URLs, e.g.
   `artIcon(mode: AppMode, name: DietIcon | GymIcon)`, `mascot(mode)`, `pattern(mode)`,
   `scene(mode)`, plus `MEAL_ICONS: Record<Meal, string>` = breakfast -> diet `egg`,
   lunch -> `salad`, dinner -> `soup`, snack -> `apple`.
2. Palette (`tailwind.config.js`): `app` -> `#fdf7e8` (cream from the art). `brand` -> sage green
   taken from the art: 50 `#f3f7f0`, 100 `#e3ecdc`, 200 `#c7d9ba`, 500 `#7a9e6a`, 600 `#5f8552`,
   700 `#4a6b40`. Add `coral: { 400: "#f58a78", 500: "#ec6f5c" }` for accents only where it helps.
   Check the white-on-`brand-600` contrast of `.btn-primary` stays >= 4.5:1; darken 600/700 if not.
3. Section background (`AppShell`): behind all content render a fixed, full-viewport, non-interactive
   layer with the current mode's `pattern.webp` (`background-size: cover`, centered,
   `pointer-events: none`, `aria-hidden`). Content/cards stay on top and readable. Keep
   `bg-app` as the fallback colour under it. `.app-header` stays translucent (tint it cream,
   e.g. `bg-[#fdf7e8]/85`) and the tab bar likewise.
4. Tab bar icons: replace the SVGs with the pixel icons (`<img>` 28x28, `alt=""`, `draggable=false`).
   Diet: Giorno -> `plate`, Cerca -> `basket`, Settimana -> `chart`. Gym: Storico -> `calendar`,
   Inizia -> `dumbbell`, Esercizi -> `book`. Impostazioni -> the current mode's `gear`.
   Inactive tabs: `grayscale opacity-60`; active: full colour, slight scale-up (1.1) and the
   label in `text-brand-700`. NavLink's `className` callback can't reach the child, so use the
   render-prop children (`{({ isActive }) => ...}`).
5. `ModeSwitch`: 20x20 cat head (`cat` icon of that section) before each label.
6. `MealSection`: meal icon (24x24) before the meal title from `MEAL_ICONS`.
7. `LoginPage`: full-screen diet `scene.webp` (`background-size: cover`, anchored bottom) with the
   existing form card in the empty upper area (card slightly translucent white + blur). All
   login steps unchanged functionally.
8. Empty states: mascot image (~120 px tall, `alt=""`) above the existing text in
   `HistoryPage` "Nessun allenamento completato." and `GymStartPage` "Nessun modello..." (gym
   mascot), `ExerciseList` "Nessun esercizio trovato." (gym), `SearchPage` "Nessun risultato." /
   "Nessun alimento recente." (diet mascot). Keep the texts identical.
9. Tests: AppShell renders the diet icons on `/` and gym icons on `/gym` (assert `img` src
   contains `/art/diet/icons/plate.png` / `/art/gym/icons/dumbbell.png`); MealSection shows the
   meal icon. All existing tests must still pass.
10. `npm test`, `npm run build`, lint. Then commit: `feat(web): pixel-art cat theme for diet and gym sections`
