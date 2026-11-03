export type FundNavRecord = {
  code: string;
  navDate: string;
  nav: number;
  dailyChangePct: number | null;
  sourceUrl: string;
  recentHistory?: Array<{ navDate: string; nav: number; dailyChangePct: number | null }>;
};

export type FundNavSource = {
  name: string;
  fetchNav: (code: string, fetcher?: typeof fetch) => Promise<FundNavRecord>;
};
