declare module "google-trends-api" {
  const trends: {
    interestOverTime(opts: { keyword: string; startTime?: Date; endTime?: Date; geo?: string }): Promise<string>;
    interestByRegion(opts: { keyword: string; startTime?: Date; geo?: string }): Promise<string>;
    relatedQueries(opts: { keyword: string; startTime?: Date; geo?: string }): Promise<string>;
    relatedTopics(opts: { keyword: string; startTime?: Date; geo?: string }): Promise<string>;
    dailyTrends(opts: { geo?: string; trendDate?: Date }): Promise<string>;
    realTimeTrends(opts: { geo?: string; category?: string }): Promise<string>;
    autoComplete(opts: { keyword: string }): Promise<string>;
  };
  export default trends;
}
