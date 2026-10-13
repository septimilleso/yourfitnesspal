import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { FoodOut, FoodSearchItem, Meal } from "../api/queries";
import { useFoodByBarcode, useFoodSearch, useRecentFoods } from "../api/queries";
import CustomFoodForm from "../components/CustomFoodForm";
import OfflineIndicator from "../components/OfflineIndicator";
import OfflineUnavailable from "../components/OfflineUnavailable";
import QuantityPicker from "../components/QuantityPicker";
import Scanner from "../components/Scanner";
import { formatIsoDateLong, todayIso } from "../lib/date";
import { mascot } from "../lib/art";
import { MEAL_LABELS } from "../lib/meals";
import { useOfflineUnavailable } from "../lib/useOfflineUnavailable";

type Tab = "recenti" | "preferiti" | "miei";

const TAB_LABELS: Record<Tab, string> = {
  recenti: "Recenti",
  preferiti: "Preferiti",
  miei: "I miei cibi",
};

/** How long to wait after the last keystroke before firing the search
 * request. */
const DEBOUNCE_MS = 350;

/** `FoodOut` (from a barcode lookup) reshaped as a `FoodSearchItem` so it
 * can flow through the same result-selection/QuantityPicker path as a
 * search result. `source` is narrowed to "off"/"cache" for the UI badge --
 * a barcode-scanned "custom" food (self-logged, no barcode really) is an
 * edge case that doesn't occur in practice since custom foods aren't
 * barcode-indexed. */
function asSearchItem(food: FoodOut): FoodSearchItem {
  return { ...food, source: food.source === "custom" ? "cache" : "off" };
}

/** Search + quantity + barcode scanner UI: debounced text search, a
 * Recenti/Preferiti/I miei cibi tab strip, and a barcode scanner shortcut
 * that both resolve into the same `QuantityPicker` confirm-and-log flow.
 * `date`/`meal` come from the URL (set by `MealSection`'s "+ Aggiungi"
 * links) and are threaded straight through to the created diary entry --
 * and are now echoed in the header, since landing here from a meal's
 * "+ Aggiungi" otherwise gave no confirmation of which meal is being
 * logged. */
function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const date = searchParams.get("date") ?? todayIso();
  const meal = (searchParams.get("meal") as Meal | null) ?? "breakfast";

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<Tab>("recenti");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState<FoodSearchItem | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const isSearching = debouncedQuery.length > 0;
  const searchResults = useFoodSearch(debouncedQuery);
  const recentFoods = useRecentFoods();
  const recentUnavailable = useOfflineUnavailable(recentFoods) && !isSearching && tab === "recenti";
  const barcodeLookup = useFoodByBarcode();

  const results: FoodSearchItem[] = isSearching
    ? (searchResults.data?.results ?? [])
    : tab === "recenti"
      ? (recentFoods.data?.results ?? [])
      : [];
  const isLoadingResults = isSearching ? searchResults.isLoading : recentFoods.isLoading;
  const offUnavailable = isSearching ? (searchResults.data?.off_unavailable ?? false) : false;

  function handleDetect(code: string) {
    setScannerOpen(false);
    setScanError(null);
    barcodeLookup.mutate(code, {
      onSuccess: (food) => setSelectedFood(asSearchItem(food)),
      onError: () => setScanError("Nessun prodotto trovato per questo codice a barre."),
    });
  }

  function handleAdded() {
    setSelectedFood(null);
    navigate(`/?date=${date}`);
  }

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto max-w-2xl px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <h1 className="text-[17px] font-semibold text-slate-900">Aggiungi alimento</h1>
                {/* Margine negativo: il pulsante da 44 px non allunga la riga del titolo (line-height circa 25,5 px). */}
                <OfflineIndicator className="relative -my-2.5 inline-flex shrink-0" />
              </div>
              <p className="truncate text-xs text-slate-500">
                {MEAL_LABELS[meal]} &middot;{" "}
                <span className="capitalize">{formatIsoDateLong(date)}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              aria-label="Scansiona codice a barre"
              className="btn-secondary shrink-0 px-3"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                className="h-5 w-5"
                aria-hidden
              >
                <path d="M4 7V5a1 1 0 0 1 1-1h2M4 17v2a1 1 0 0 0 1 1h2M20 7V5a1 1 0 0 0-1-1h-2M20 17v2a1 1 0 0 1-1 1h-2M7 8v8M10 8v8M13 8v8M17 8v8" />
              </svg>
              Scansiona
            </button>
          </div>

          {/* Search field: pill-shaped with a leading glyph, the iOS
              UISearchBar shape users expect at the top of a list. */}
          <div className="mt-2 pb-2">
            <div className="relative">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cerca un alimento..."
                aria-label="Cerca un alimento"
                className="field rounded-full border-transparent bg-slate-100 pl-10"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {!isSearching && (
          /* Segmented control (iOS), not an underlined web tab strip. */
          <div
            role="tablist"
            aria-label="Sorgente risultati"
            className="flex gap-1 rounded-xl bg-slate-200/70 p-1 text-sm"
          >
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-[36px] flex-1 rounded-lg px-2 font-medium transition ${
                  tab === t
                    ? "bg-white text-slate-900 shadow-card"
                    : "text-slate-500 active:text-slate-700"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        )}

        {scanError && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {scanError}
          </p>
        )}

        {offUnavailable && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            OpenFoodFacts è momentaneamente non raggiungibile: qui sotto vedi solo i risultati già in
            cache. Riprova tra poco.
          </p>
        )}

        {!isSearching && tab === "preferiti" && (
          <p className="card px-4 py-6 text-center text-sm text-slate-400">
            I preferiti arriveranno presto.
          </p>
        )}
        {!isSearching && tab === "miei" && (
          <CustomFoodForm onCreated={(food) => setSelectedFood(asSearchItem(food))} />
        )}

        {(isSearching || tab === "recenti") && (
          <>
            <h2 className="section-label">{isSearching ? "Risultati" : "Recenti"}</h2>
            <ul className="card divide-y divide-slate-100 overflow-hidden">
              {results.map((food) => (
                <li key={food.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedFood(food)}
                    className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left active:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-slate-900">
                        {food.name}
                      </span>
                      {food.brand && (
                        <span className="block truncate text-[13px] text-slate-500">{food.brand}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        food.source === "off"
                          ? "bg-brand-50 text-brand-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {food.source === "off" ? "OFF" : "cache"}
                    </span>
                    <span aria-hidden className="shrink-0 text-lg leading-none text-slate-300">
                      &rsaquo;
                    </span>
                  </button>
                </li>
              ))}
              {recentUnavailable && (
                <li className="px-4">
                  <OfflineUnavailable compact />
                </li>
              )}
              {!recentUnavailable && results.length === 0 && !isLoadingResults && !offUnavailable && (
                <li className="px-4 py-6 text-center">
                  <img
                    src={mascot("diet")}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="mx-auto mb-3 h-[120px] w-auto object-contain"
                  />
                  <p className="text-sm text-slate-400">
                    {isSearching ? "Nessun risultato." : "Nessun alimento recente."}
                  </p>
                </li>
              )}
            </ul>
          </>
        )}

        {isLoadingResults && !recentUnavailable && <p className="text-center text-sm text-slate-500">Caricamento...</p>}
      </div>

      {scannerOpen && <Scanner onDetect={handleDetect} onClose={() => setScannerOpen(false)} />}

      {selectedFood && (
        <QuantityPicker
          food={selectedFood}
          date={date}
          meal={meal}
          onClose={() => setSelectedFood(null)}
          onAdded={handleAdded}
        />
      )}
    </div>
  );
}

export default SearchPage;
