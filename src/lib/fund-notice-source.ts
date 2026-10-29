export const TIANTIAN_NOTICE_ID = /^(?:AN|AP)\d{12,24}$/;

export function tiantianNoticePdfUrl(id: string): string {
  if (!TIANTIAN_NOTICE_ID.test(id)) throw new Error("无效天天基金公告编号");
  return `https://pdf.dfcfw.com/pdf/H2_${id}_1.pdf`;
}

/** Only accepted official-disclosure mirrors are treated as quota evidence. */
export function noticeSourceSql(alias: string): string {
  return `(${alias}.source_url LIKE 'http://eid.csrc.gov.cn/fund/disclose/%'
    OR ${alias}.source_url LIKE 'https://eid.csrc.gov.cn/fund/disclose/%'
    OR ${alias}.source_url LIKE 'https://pdf.dfcfw.com/pdf/H2_%_1.pdf')`;
}

export function noticePreviewUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === "eid.csrc.gov.cn" && url.pathname === "/fund/disclose/instance_show_pdf_id.do") {
      const id = url.searchParams.get("instanceid");
      return id && /^\d{1,12}$/.test(id) ? `/api/market/evidence-pdf?instanceid=${id}` : null;
    }
    if (url.protocol === "https:" && url.hostname === "pdf.dfcfw.com") {
      const id = /^\/pdf\/H2_((?:AN|AP)\d{12,24})_1\.pdf$/.exec(url.pathname)?.[1];
      return id ? `/api/market/evidence-pdf?noticeid=${id}` : null;
    }
  } catch { /* Invalid evidence URL has no preview. */ }
  return null;
}
