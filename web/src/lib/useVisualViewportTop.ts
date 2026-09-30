import { useEffect, useState } from "react";

/** Keeps the live workout header aligned after iOS 26 WebKit's keyboard-dismiss visual viewport bug (297779 / FB19889436; spec). */
export function useVisualViewportTop(): number {
  const [top, setTop] = useState(() => window.visualViewport?.offsetTop ?? 0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const updateTop = () => setTop(viewport.offsetTop);
    viewport.addEventListener("scroll", updateTop);
    viewport.addEventListener("resize", updateTop);
    return () => {
      viewport.removeEventListener("scroll", updateTop);
      viewport.removeEventListener("resize", updateTop);
    };
  });

  return top;
}
