"use client";

import { useState } from "react";
import { noticePreviewUrl } from "@/lib/fund-notice-source";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type EvidenceDialogProps = {
  kind: "sales" | "notice";
  fundName: string;
  code: string;
  sourceUrl: string;
  sellers?: Array<{ name: string; sourceUrl: string | null }>;
};

function NoticePages({ url }: { url: string }) {
  return <iframe title="基金公告 PDF 预览" src={url}
    className="min-h-0 w-full flex-1 rounded-md border border-border bg-white" />;
}

export function EvidenceDialog({ kind, fundName, code, sourceUrl, sellers = [] }: EvidenceDialogProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const previewUrl = kind === "notice" ? noticePreviewUrl(sourceUrl) : null;
  const label = kind === "sales" ? "销售机构依据" : "公告依据";
  const sourceUrls = kind === "sales"
    ? [...new Set(sellers.map((seller) => seller.sourceUrl).filter((url): url is string => Boolean(url)))]
    : [sourceUrl];

  return <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); setCopied(false); }}>
    <DialogTrigger asChild>
      <button type="button" className="mt-1 block cursor-pointer text-xs text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}
      </button>
    </DialogTrigger>
    <DialogContent className={`flex h-[85vh] max-h-[90vh] flex-col ${kind === "notice" ? "sm:max-w-[min(96vw,1000px)]" : "sm:max-w-[min(96vw,760px)]"}`}>
      <DialogHeader>
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{fundName}（{code}）</DialogDescription>
      </DialogHeader>
      {kind === "sales" ? <div className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm">
        <p>已核验代销机构：{sellers.length} 家</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {sellers.map((seller) => <li key={seller.name} className="rounded-md border border-border px-3 py-2">
            {seller.name.includes("蚂蚁") ? `蚂蚁财富 · ${seller.name}` : seller.name}
          </li>)}
        </ul>
      </div> : previewUrl && open ? <NoticePages url={previewUrl} /> : <p className="text-sm text-muted-foreground">这条公告暂时无法在站内预览。</p>}
      {kind === "sales" ? <div className="flex items-start gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
        <div className="min-w-0 flex-1 break-all">核验来源：
          {sourceUrls.map((url) => <p key={url}>{url}</p>)}
        </div>
        <Button type="button" variant="outline" size="xs" onClick={async () => {
          try {
            await navigator.clipboard.writeText(sourceUrls.join("\n"));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}>{copied ? "已复制" : "复制地址"}</Button>
      </div> : previewUrl ? <div className="border-t border-border pt-3 text-right text-xs text-muted-foreground">
        <a href={previewUrl} download={`notice-${code}.pdf`}
          className="underline hover:text-foreground">下载 PDF 原文</a>
      </div> : null}
    </DialogContent>
  </Dialog>;
}
