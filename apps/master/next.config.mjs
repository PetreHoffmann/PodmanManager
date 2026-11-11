import { fileURLToPath } from "node:url";

const standalone = process.env.NEXT_OUTPUT === "standalone";

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Only for container images: self-contained server in .next/standalone
  ...(standalone && {
    output: "standalone",
    outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  }),
  async headers() {
    return [{
      // everything except the navbar logo (its URL carries a content hash and is cached by the route itself)
      source: "/:path((?!brand/logo$).*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ],
    }];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), { "node:sqlite": "commonjs node:sqlite" }];
    }
    return config;
  },
};
export default nextConfig;
