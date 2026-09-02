import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['192.168.1.200',],
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
   output: "standalone",
};

export default nextConfig;
