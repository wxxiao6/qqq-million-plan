import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { AppNav } from "@/components/app-nav";
import { getCurrentUser } from "@/server/auth/context";
import { UiProviders } from "@/components/ui-providers";
import "./globals.css";

const display = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "qqq-million-plan",
  description: "个人财务工作台：资产、持仓、纳指额度与市场关注度。",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const user = await getCurrentUser();
  return (
    <html
      lang="zh-CN"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground" suppressHydrationWarning>
        <UiProviders>
          <AppNav authenticated={Boolean(user)} />
          <main className="app-main mx-auto w-full max-w-7xl px-5 py-9 sm:px-8 lg:px-10 lg:py-14">
            {children}
          </main>
        </UiProviders>
      </body>
    </html>
  );
}
