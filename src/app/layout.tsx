import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { PwaManager } from "@/components/pwa-manager";
import { isLocalE2EMode } from "@/lib/e2e-mode";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "守中日课｜个人每日管理库",
    template: "%s｜守中日课",
  },
  description: "把脑中的混乱交给系统，让每天的行动与长期方向保持一致。",
  applicationName: "守中日课",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "守中日课",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f5ef",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const localOnly = isLocalE2EMode();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {children}
        <PwaManager disabled={localOnly} />
        <Toaster
          position="top-center"
          toastOptions={{
            style: {
              background: "var(--surface)",
              borderColor: "var(--line)",
              color: "var(--ink)",
            },
          }}
        />
      </body>
    </html>
  );
}
