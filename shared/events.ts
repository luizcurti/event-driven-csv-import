export interface EventEnvelope<TDetail extends Record<string, unknown>> {
  version: string;
  source: string;
  detailType: string;
  correlationId: string;
  importId: string;
  timestamp: string;
  detail: TDetail;
}

export const createEvent = <TDetail extends Record<string, unknown>>(
  detailType: string,
  correlationId: string,
  importId: string,
  detail: TDetail,
  source = 'event-driven-data-ingestion',
): EventEnvelope<TDetail> => ({
  version: '1.0',
  source,
  detailType,
  correlationId,
  importId,
  timestamp: new Date().toISOString(),
  detail,
});