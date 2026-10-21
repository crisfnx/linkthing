import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Static per deploy, so it can't widen when one user turns a setting on. It
// grows by milestone instead: M7 adds `https:` to img-src, M8 adds
// https://api.anthropic.com to connect-src (PRD §8.7).
const contentSecurityPolicy = [
  "default-src 'self'",
  // 'unsafe-inline': the App Router streams its payload in inline <script>
  // tags, and nonces would force dynamic rendering (PRD §8.7).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
        ],
      },
    ];
  },
};

export default nextConfig;
