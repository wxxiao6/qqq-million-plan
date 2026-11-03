"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Download, Share, Smartphone, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallContext = createContext<{ prompt: InstallPrompt | null; consume: () => void }>({ prompt: null, consume: () => {} });
const serverOnline = () => true;
const onlineSnapshot = () => navigator.onLine;
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => { window.removeEventListener("online", callback); window.removeEventListener("offline", callback); };
}
const serverStandalone = () => false;
const standaloneSnapshot = () => window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
function subscribeStandalone(callback: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => { media.removeEventListener("change", callback); window.removeEventListener("appinstalled", callback); };
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const requestedUpdate = useRef(false);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnline);

  useEffect(() => {
    function beforeInstall(event: Event) { event.preventDefault(); setPrompt(event as InstallPrompt); }
    function installed() { setPrompt(null); }
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", beforeInstall); window.removeEventListener("appinstalled", installed); };
  }, []);

  useEffect(() => {
    // Keep Next development/HMR out of service-worker control.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    function stateChanged() {
      if (!disposed && installing?.state === "installed" && navigator.serviceWorker.controller) setWaiting(registration?.waiting ?? installing);
    }
    function foundUpdate() {
      installing?.removeEventListener("statechange", stateChanged);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", stateChanged);
    }
    function controllerChanged() {
      if (requestedUpdate.current) window.location.reload();
    }
    function checkUpdate() {
      if (document.visibilityState === "visible" && navigator.onLine) void registration?.update().catch(() => {});
    }
    navigator.serviceWorker.addEventListener("controllerchange", controllerChanged);
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((result) => {
      if (disposed) return;
      registration = result;
      if (result.waiting) setWaiting(result.waiting);
      result.addEventListener("updatefound", foundUpdate);
      if (result.installing) foundUpdate();
      checkUpdate();
    }).catch(() => { /* Installation remains available when a browser disallows service workers. */ });
    document.addEventListener("visibilitychange", checkUpdate);
    window.addEventListener("online", checkUpdate);
    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", foundUpdate);
      installing?.removeEventListener("statechange", stateChanged);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChanged);
      document.removeEventListener("visibilitychange", checkUpdate);
      window.removeEventListener("online", checkUpdate);
    };
  }, []);

  return <InstallContext.Provider value={{ prompt, consume: () => setPrompt(null) }}>
    {!online && <div role="status" className="border-b border-border bg-secondary px-5 py-3 text-center text-sm"><WifiOff className="mr-2 inline size-4" aria-hidden="true" />当前离线，页面数据可能不是最新；请联网后再操作。</div>}
    {children}
    {waiting && online && <div role="status" className="pwa-update fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-sm shadow-lg">
      <div><p className="font-medium">新版本已准备好</p><p className="mt-1 text-xs text-muted-foreground">请先保存正在填写的内容，再更新。</p></div>
      <Button disabled={updating} onClick={() => {
        if (waiting.state !== "installed") { window.location.reload(); return; }
        requestedUpdate.current = true;
        setUpdating(true);
        waiting.postMessage({ type: "SKIP_WAITING" });
      }}>{updating ? "正在更新…" : "刷新更新"}</Button>
    </div>}
  </InstallContext.Provider>;
}

export function InstallAppButton() {
  const { prompt, consume } = useContext(InstallContext);
  const standalone = useSyncExternalStore(subscribeStandalone, standaloneSnapshot, serverStandalone);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (standalone) return null;

  async function install() {
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") setOpen(false);
    } finally { consume(); setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="icon-lg" aria-label="添加到手机主屏幕" title="添加到主屏幕"><Smartphone aria-hidden="true" /></Button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader>
        <span className="brand-mark mb-3 size-12! text-2xl!" aria-hidden="true">¥</span>
        <DialogTitle>把百万纳指放进手机</DialogTitle>
        <DialogDescription className="mt-2 leading-relaxed">添加到主屏幕，像 App 一样打开。随时查看雷达、持仓和定投。</DialogDescription>
      </DialogHeader>
      {prompt ? <Button size="lg" disabled={busy} onClick={() => { void install().catch(() => setOpen(true)); }}><Download aria-hidden="true" />{busy ? "正在打开安装窗口…" : "安装应用"}</Button> : <div className="space-y-4 rounded-xl bg-secondary/60 p-4 text-sm">
        <div><p className="font-medium">iPhone / iPad</p><p className="mt-1.5 leading-relaxed text-muted-foreground">用 Safari 打开本站，点<Share className="mx-1 inline size-4" aria-label="分享" />分享，选择「添加到主屏幕」，再点「添加」。如果出现「作为网页 App 打开」，请保持开启。</p></div>
        <div><p className="font-medium">安卓手机</p><p className="mt-1.5 leading-relaxed text-muted-foreground">用 Chrome 或 Edge 打开本站，在浏览器菜单中选择「安装应用」或「添加到主屏幕」。</p></div>
      </div>}
      <p className="text-xs leading-relaxed text-muted-foreground">微信等内置浏览器请先选择「在浏览器中打开」。安装后可能需要重新登录，查看最新数据需要联网。</p>
    </DialogContent>
  </Dialog>;
}
