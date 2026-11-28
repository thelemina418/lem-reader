import type { IngestionResponse } from "../src/ingestion/types";
export interface IngestAdapterResult {
    status: number;
    body: IngestionResponse;
}
/**
 * handleIngestBody — turn an inbound request body into `{ status, body }`.
 *
 * Pre-conditions: the wrapper has already pulled the raw bytes off the wire
 * (Pages Function: `await context.request.json()`; Vite middleware:
 * `JSON.parse(await readBody(req))`). Both wrappers hand the parsed value
 * (or null) here.
 *
 * Post-conditions: returns a 200/400 status + an IngestionResponse suitable
 * for `Response.json(body, { status })` (Pages Function) or
 * `res.statusCode = status; res.json(body)` (Vite middleware).
 */
export declare function handleIngestBody(body: unknown): Promise<IngestAdapterResult>;
