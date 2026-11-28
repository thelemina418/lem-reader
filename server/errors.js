/**
 * IngestionError — thrown by /server pipeline stages on any anticipated
 * refusal. Carries a typed `.reason` drawn from IngestionFailureReasonEnum so
 * the client can map it to a calm status phrase without parsing the message.
 */
export class IngestionError extends Error {
    reason;
    constructor(reason, message) {
        super(message ?? reason);
        this.reason = reason;
        this.name = "IngestionError";
        // Restore the prototype chain across the ES5-ish Error subclass quirks
        // (defensive — Node 22 preserves it, but bundled runtimes may not).
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
