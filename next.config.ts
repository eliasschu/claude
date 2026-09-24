import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Bilder von externen Anbietern bewusst nicht freigeschaltet:
  // Das MVP verwendet ausschliesslich eigene, generierte Wortmarken statt fremder Logos.
  images: { remotePatterns: [] },
};

export default nextConfig;
