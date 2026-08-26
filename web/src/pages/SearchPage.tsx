import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import type { FoodOut, FoodSearchItem, Meal } from "../api/queries";
import { useFoodByBarcode, useFoodSearch, useRecentFoods } from "../api/queries";
import CustomFoodForm from "../components/CustomFoodForm";
import QuantityPicker from "../components/QuantityPicker";
import Scanner from "../components/Scanner";
import { todayIso } from "../lib/date";

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
 * links) and are threaded straight through to the created diary entry. */
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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-900">Aggiungi alimento</h1>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          aria-label="Scansiona codice a barre"
          className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Scansiona
        </button>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cerca un alimento..."
        aria-label="Cerca un alimento"
        className="w-full rounded border border-slate-300 px-3 py-2"
      />

      {!isSearching && (
        <div role="tablist" aria-label="Sorgente risultati" className="flex gap-4 border-b border-slate-200 text-sm">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-1 pb-2 font-medium ${
                tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {scanError && (
        <p role="alert" className="text-sm text-red-600">
          {scanError}
        </p>
      )}

      {offUnavailable && (
        <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          OpenFoodFacts è momentaneamente non raggiungibile: qui sotto vedi solo i risultati già in
          cache. Riprova tra poco.
        </p>
      )}

      {!isSearching && tab === "preferiti" && (
        <p className="text-sm text-slate-400">I preferiti arriveranno presto.</p>
      )}
      {!isSearching && tab === "miei" && (
        <CustomFoodForm onCreated={(food) => setSelectedFood(asSearchItem(food))} />
      )}

      {(isSearching || tab === "recenti") && (
        <ul className="divide-y divide-slate-100">
          {results.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => setSelectedFood(food)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{food.name}</span>
                  {food.brand && <span className="block truncate text-xs text-slate-500">{food.brand}</span>}
                </span>
                <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs uppercase text-slate-500">
                  {food.source === "off" ? "OFF" : "cache"}
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 && !isLoadingResults && !offUnavailable && (
            <p className="py-2 text-sm text-slate-400">Nessun risultato.</p>
          )}
        </ul>
      )}

      {isLoadingResults && <p className="text-sm text-slate-500">Caricamento...</p>}

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
