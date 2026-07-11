/** Load Cloudflare Web Analytics when a beacon token is configured. */
export function initAnalytics(): void {
  const token = import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined;
  if (!token?.trim()) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute(
    "data-cf-beacon",
    JSON.stringify({ token: token.trim() }),
  );
  document.body.appendChild(script);
}
