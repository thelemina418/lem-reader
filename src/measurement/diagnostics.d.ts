import type { DiagnosticEvent } from "./types";
/**
 * DiagnosticBus — pub-sub with V5 boundary validation + an in-memory ring
 * buffer. Subscribers are plain functions; subscribe() returns an
 * unsubscribe closure (mirrors the project's listener+cleanup convention
 * from SettingsContext / useScrollSave).
 */
export declare class DiagnosticBus {
    private subscribers;
    private ring;
    /**
     * Validate `event` against DiagnosticEventSchema (V5 — emit boundary) and
     * forward to every active subscriber. A malformed payload throws (never
     * silently swallows an unknown kind — that would let an injection into
     * the Phase 4 UI pass undetected).
     */
    emit(event: DiagnosticEvent): void;
    /**
     * Register a subscriber. Returns an unsubscribe closure that stops
     * further delivery (mirrors the listener+cleanup pattern in
     * SettingsContext L154–165 and useScrollSave L172–174).
     */
    subscribe(handler: (event: DiagnosticEvent) => void): () => void;
    /**
     * Snapshot of the last N emitted events (oldest first). Phase 4's PAGE-09
     * UI consumes this; Phase 3 has no reader-facing consumer.
     */
    recent(): readonly DiagnosticEvent[];
}
