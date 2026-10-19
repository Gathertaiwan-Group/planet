import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@planet/shared"],
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ozwftlkgqmewtadypsfi.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
