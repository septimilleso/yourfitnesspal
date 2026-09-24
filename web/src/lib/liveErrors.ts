import { createContext } from "react";

/** Where live-session mutations report a failure (the workout page shows a toast). */
export const LiveErrorContext = createContext<(message: string) => void>(() => {});
