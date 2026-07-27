"use client";

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, Share } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaManager() {
  const updateAccepted = useRef(false);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onInstall);

    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const dismissed = sessionStorage.getItem("shouzhong:ios-install-dismissed");
    queueMicrotask(() => setShowIos(ios && !standalone && !dismissed));

    const serwist = window.serwist;
    const onWaiting = () => {
      toast("守中日课有新版本", {
        description: "更新不会影响已保存在本机的记录。",
        action: {
          label: "立即更新",
          onClick: () => {
            updateAccepted.current = true;
            serwist.messageSkipWaiting();
          },
        },
        duration: Infinity,
      });
    };
    const onControlling = () => {
      if (updateAccepted.current) window.location.reload();
    };
    serwist?.addEventListener("waiting", onWaiting);
    serwist?.addEventListener("controlling", onControlling);

    return () => {
      window.removeEventListener("beforeinstallprompt", onInstall);
      serwist?.removeEventListener("waiting", onWaiting);
      serwist?.removeEventListener("controlling", onControlling);
    };
  }, []);

  if (
    process.env.NEXT_PUBLIC_E2E_MODE === "1" ||
    (!installPrompt && !showIos)
  ) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xl md:bottom-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">安装守中日课</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {showIos
            ? "在 Safari 点“分享”，再选“添加到主屏幕”。"
            : "作为独立应用打开，离线也能记录。"}
        </p>
      </div>
      {showIos ? (
        <>
          <Share className="size-5 text-[var(--river)]" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              sessionStorage.setItem("shouzhong:ios-install-dismissed", "1");
              setShowIos(false);
            }}
          >
            知道了
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          onClick={async () => {
            await installPrompt?.prompt();
            setInstallPrompt(null);
          }}
        >
          <Download />
          安装
        </Button>
      )}
      <RefreshCw className="hidden" aria-hidden />
    </div>
  );
}
