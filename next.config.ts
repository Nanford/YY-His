import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // 干预素材 URL 均带内容哈希 ?v=（convert-rules 生成，内容变则 URL 变），
        // 可安全 immutable 长缓存——带宽受限服务器上重复访问零下载（2026-07-20 确认）。
        source: "/interventions/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
