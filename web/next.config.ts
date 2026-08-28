import type { NextConfig } from "next";

// Single source of truth for the Content-Security-Policy. Kept here (rather
// than duplicated across routes/middleware) so there's exactly one place to
// update when a new external resource is needed.
//
// - `img-src`/`worker-src` need `blob:` and `data:` for maplibre-gl, which
//   renders tiles into canvas via blob workers and inline data URIs.
// - `connect-src`/`img-src` allow `https://tiles.openfreemap.org`, the
//   vector tile source used by the map.
// - Place geocoding is deliberately NOT listed here: the browser calls our
//   own /api/geocode, which proxies the upstream geocoder server-side. Keep
//   it that way — a browser cannot set the descriptive `User-Agent` that
//   Nominatim's usage policy requires, and the proxy is also where the
//   rate limiting and caching live. See src/app/api/geocode/route.ts.
// - `style-src 'unsafe-inline'` is required by maplibre-gl, which injects
//   inline <style> for its canvas/marker CSS.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next.js itself: the App Router streams
  // its RSC/flight payload and hydration bootstrap as inline <script> tags,
  // so a bare 'self' blocks hydration and no client component ever mounts.
  // The stricter alternative is a per-request nonce via middleware; adopt
  // that if/when a middleware layer is added for other reasons.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tiles.openfreemap.org",
  "font-src 'self' data:",
  "connect-src 'self' https://tiles.openfreemap.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // Enables a self-contained build (.next/standalone) for the Docker image —
  // see web/Dockerfile.
  output: "standalone",
  // Pin the file-tracing root to this app. Without this, Next.js can infer
  // the workspace root from an unrelated lockfile higher up the filesystem
  // (e.g. on a dev machine with other projects checked out nearby), which
  // would produce an incorrect .next/standalone output.
  outputFileTracingRoot: import.meta.dirname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
