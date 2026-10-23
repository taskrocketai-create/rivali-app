import type { NextConfig } from "next";
const standalone = process.env.RIVALI_UPLOADER_STANDALONE === "1";
const nextConfig: NextConfig = {
  async redirects() { return standalone ? [{source:"/",destination:"/race-day/uploader",permanent:false}] : []; },
};
export default nextConfig;
