import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "百万纳指计划",
    short_name: "百万纳指",
    description: "查看纳指基金额度、记录持仓和管理定投。",
    lang: "zh-CN",
    start_url: "/quota",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ec",
    theme_color: "#f7f3ec",
    icons: [
      { src: "/icons/nasdaq-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/nasdaq-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/nasdaq-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "我的持仓", url: "/holdings/manage" },
      { name: "我的定投", url: "/dca" },
    ],
  };
}
