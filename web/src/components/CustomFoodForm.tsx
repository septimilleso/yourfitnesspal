import { useState } from "react";

import type { FoodOut } from "../api/queries";
import { useCreateCustomFood } from "../api/queries";

interface FormState {
  name: string;
  brand: string;
  serving_size_g: string;
  kcal: string;
  protein_g: string;
  carbs_g: string;
  sugars_g: string;
  fat_g: string;
  sat_fat_g: string;
  fiber_g: string;
  salt_g: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  brand: "",
  serving_size_g: "",
  kcal: "",
  protein_g: "",
  carbs_g: "",
  sugars_g: "",
  fat_g: "",
  sat_fat_g: "",
  fiber_g: "",
  salt_g: "",
};

const NUTRIMENT_FIELDS: { key: keyof FormState; label: string }[] = [
  { key: "kcal", label: "Calorie (kcal)" },
  { key: "protein_g", label: "Proteine (g)" },
  { key: "carbs_g", label: "Carboidrati (g)" },
  { key: "sugars_g", label: "di cui zuccheri (g)" },
  { key: "fat_g", label: "Grassi (g)" },
  { key: "sat_fat_g", label: "di cui saturi (g)" },
  { key: "fiber_g", label: "Fibre (g)" },
  { key: "salt_g", label: "Sale (g)" },
];

/** Form to create a custom (non-OFF) food: name + all 8 per-100g nutriment
 * fields (required, same as an OFF-sourced food -- there's no partial
 * representation) + optional brand/serving size. On success hands the
 * newly-created food up via `onCreated` so the caller can route it straight
 * into `QuantityPicker`, same as a search result or barcode scan. */
function CustomFoodForm({ onCreated }: { onCreated: (food: FoodOut) => void }) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const createFood = useCreateCustomFood();

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createFood.mutate(
      {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        serving_size_g: form.serving_size_g === "" ? null : Number(form.serving_size_g),
        nutriments: {
          kcal: Number(form.kcal),
          protein_g: Number(form.protein_g),
          carbs_g: Number(form.carbs_g),
          sugars_g: Number(form.sugars_g),
          fat_g: Number(form.fat_g),
          sat_fat_g: Number(form.sat_fat_g),
          fiber_g: Number(form.fiber_g),
          salt_g: Number(form.salt_g),
        },
      },
      {
        onSuccess: (food) => {
          onCreated(food);
          setForm(EMPTY_FORM);
        },
      },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Two grouped cards -- identity, then the nutrition label -- instead
          of one long undifferentiated column of eleven inputs. */}
      <div className="card space-y-4 p-4">
        <div>
          <label htmlFor="custom-food-name" className="field-label">
            Nome
          </label>
          <input
            id="custom-food-name"
            type="text"
            required
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="custom-food-brand" className="field-label">
            Marca (opzionale)
          </label>
          <input
            id="custom-food-brand"
            type="text"
            value={form.brand}
            onChange={(e) => handleChange("brand", e.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="custom-food-serving" className="field-label">
            Porzione predefinita in grammi (opzionale)
          </label>
          <input
            id="custom-food-serving"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={form.serving_size_g}
            onChange={(e) => handleChange("serving_size_g", e.target.value)}
            className="field mt-1.5"
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[13px] font-medium text-slate-600">
          Valori nutrizionali per 100&nbsp;g, come su un&apos;etichetta alimentare.
        </p>
        <div className="divide-y divide-slate-100">
          {NUTRIMENT_FIELDS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-3 px-4 py-2">
              <label
                htmlFor={`custom-food-${key}`}
                className="flex-1 text-[15px] font-medium text-slate-700"
              >
                {label}
              </label>
              <input
                id={`custom-food-${key}`}
                type="number"
                required
                inputMode="decimal"
                min="0"
                step="any"
                value={form[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="min-h-[44px] w-24 rounded-xl border border-slate-300 px-3 py-2 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          ))}
        </div>
      </div>

      <button type="submit" disabled={createFood.isPending} className="btn-primary w-full">
        {createFood.isPending ? "Salvataggio..." : "Crea alimento"}
      </button>

      {createFood.isError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Errore nella creazione dell&apos;alimento.
        </p>
      )}
    </form>
  );
}

export default CustomFoodForm;
