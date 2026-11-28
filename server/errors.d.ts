import type { IngestionFailureReason } from "../src/ingestion/types";
/**
 * IngestionError — thrown by /server pipeline stages on any anticipated
 * refusal. Carries a typed `.reason` drawn from IngestionFailureReasonEnum so
 * the client can map it to a calm status phrase without parsing the message.
 */
export declare class IngestionError extends Error {
    readonly reason: IngestionFailureReason;
    constructor(reason: IngestionFailureReason, message?: string);
}
