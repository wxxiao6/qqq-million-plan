export type FundNavRecord = {
  code: string;
  navDate: string;
  nav: number;
  dailyChangePct: number | null;
  sourceUrl: string;
};

export type FundNavSource = {
  name: string;
  fetchNav: (code: string, fetcher?: typeof fetch) => Promise<FundNavRecord>;
};
