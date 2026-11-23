/**
 * Privacy-first GoatCounter beacon loader (cookie-free, no-op in dev or if VITE_GOATCOUNTER_URL is unset).
 */
export function initAnalytics(): void {
  if (!import.meta.env.PROD) return;
  const endpoint = import.meta.env.VITE_GOATCOUNTER_URL as string | undefined;
  if (!endpoint || typeof document === 'undefined') return;

  const existing = document.querySelector('script[data-goatcounter]');
  if (existing) return;

  const script = document.createElement('script');
  script.async = true;
  script.setAttribute('data-goatcounter', endpoint);
  script.src = 'https://gc.zgo.at/count.js';
  document.head.appendChild(script);
}
