// Mirrors FIGMA_WEBHOOK_EVENT_REQUEST_SCHEMA in the Connect app
// (src/web/routes/figma/schemas.ts), without the AJV dependency.
export type FigmaWebhookEvent =
  | { readonly event_type: 'PING'; readonly webhook_id: string; readonly passcode: string }
  | { readonly event_type: 'FILE_UPDATE'; readonly webhook_id: string; readonly passcode: string; readonly file_key: string }
  | { readonly event_type: 'FILE_DELETE'; readonly webhook_id: string; readonly passcode: string; readonly file_key: string }
  | { readonly event_type: 'DEV_MODE_STATUS_UPDATE'; readonly webhook_id: string; readonly passcode: string; readonly file_key: string };

const REQUIRED_FIELDS: Record<FigmaWebhookEvent['event_type'], readonly string[]> = {
  PING: ['webhook_id', 'passcode', 'timestamp'],
  FILE_UPDATE: ['webhook_id', 'passcode', 'file_key', 'file_name', 'timestamp'],
  FILE_DELETE: ['webhook_id', 'passcode', 'file_key'],
  DEV_MODE_STATUS_UPDATE: ['webhook_id', 'passcode', 'file_key', 'status'],
};

export function parseFigmaWebhookEvent(raw: string | undefined): FigmaWebhookEvent | undefined {
  if (raw === undefined) {
    return undefined;
  }

  let body: unknown;

  try {
    body = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  const record = body as Record<string, unknown>;

  const eventType = record.event_type;

  if (typeof eventType !== 'string' || !(eventType in REQUIRED_FIELDS)) {
    return undefined;
  }

  const required = REQUIRED_FIELDS[eventType as FigmaWebhookEvent['event_type']];

  const complete = required.every((field) => typeof record[field] === 'string');

  return complete ? (record as unknown as FigmaWebhookEvent) : undefined;
}
