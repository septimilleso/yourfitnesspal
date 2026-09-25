/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#fdf7e8",
        /* Accent. Green = the app's one "on track" signal, used for the
           calorie ring, primary buttons and the active tab. */
        brand: {
          50: "#f3f7f0",
          100: "#e3ecdc",
          200: "#c7d9ba",
          500: "#7a9e6a",
          600: "#567a49",
          700: "#426039",
        },
        coral: {
          400: "#f58a78",
          500: "#ec6f5c",
        },
        /* One colour per macro, so a bar/legend is identifiable without
           reading its label. */
        macro: {
          protein: "#3b82f6",
          carbs: "#f59e0b",
          fat: "#a855f7",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        /* Deliberately subtle -- the card's hairline border does the
           separating; the shadow only lifts it off the grey page. */
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        /* Bottom sheets and the floating action bar. */
        sheet: "0 -8px 30px -12px rgb(15 23 42 / 0.25)",
      },
      spacing: {
        /* `pb-safe` etc. for one-off safe-area padding. */
        safe: "var(--safe-bottom)",
        "safe-top": "var(--safe-top)",
        nav: "var(--nav-height)",
      },
      borderRadius: {
        sheet: "1.25rem",
      },
    },
  },
  plugins: [],
};
