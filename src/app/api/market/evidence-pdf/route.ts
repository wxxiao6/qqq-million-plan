import { NextRequest } from "next/server";
import { TIANTIAN_NOTICE_ID, tiantianNoticePdfUrl } from "@/lib/fund-notice-source";
import { getDocumentProxy } from "unpdf";

const PDF_ENDPOINT = "http://eid.csrc.gov.cn/fund/disclose/instance_show_pdf_id.do";

export async function GET(request: NextRequest) {
  const instanceId = request.nextUrl.searchParams.get("instanceid");
  const noticeId = request.nextUrl.searchParams.get("noticeid");
  if (!(instanceId && /^\d{1,12}$/.test(instanceId)) && !(noticeId && TIANTIAN_NOTICE_ID.test(noticeId))) {
    return new Response("无效公告编号", { status: 400 });
  }
  try {
    const sourceUrl = noticeId && TIANTIAN_NOTICE_ID.test(noticeId)
      ? tiantianNoticePdfUrl(noticeId) : `${PDF_ENDPOINT}?instanceid=${instanceId}`;
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return new Response("公告暂时无法获取", { status: 502 });
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 20_000_000 ||
        new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      return new Response("公告文件格式无效", { status: 502 });
    }
    const format = request.nextUrl.searchParams.get("format");
    if (format === "meta") {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const totalPages = pdf.numPages;
      await pdf.cleanup();
      return Response.json({ totalPages }, {
        headers: { "Cache-Control": "public, max-age=86400" },
      });
    }
    if (format === "page") {
      return new Response("请使用 PDF 原文预览公告", { status: 410 });
    }
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="notice-${noticeId ?? instanceId}.pdf"`,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("公告预览失败", error);
    return new Response("公告暂时无法获取", { status: 502 });
  }
}
