import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 绿色便携包（scripts/pack-share.mjs）：standalone 产物 + 便携 Node + 预迁移 SQLite，
  // 收件人解压双击启动.bat即用，无需装 Node/联网（语音链路缺密钥自动降级）
  output: "standalone",
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

