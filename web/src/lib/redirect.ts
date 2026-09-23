/** Full-page navigation to another origin (the OAuth client's callback). Wrapped so tests can mock it. */
export function redirectTo(url: string) {
  window.location.assign(url);
}
