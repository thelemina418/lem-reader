/**
 * Sentinel thrown when a measurement pass is cancelled via its AbortSignal.
 * The engine's catch path checks `instanceof AbortError` to distinguish
 * cancellation (silent drop) from real errors (emit measurement-error).
 */
export declare class AbortError extends Error {
    readonly name = "AbortError";
    constructor(message?: string);
}
/**
 * Await `document.fonts.ready`, throwing `AbortError` if `signal` is or
 * becomes aborted. The font-set may change between triggers (font swap,
 * first web-font load, future D2-06 dyslexic web-font); re-awaiting `.ready`
 * after every bump is the only portable way to catch a swap.
 *
 * Composes with Epoch: pass the AbortSignal returned by `epoch.bump()` so
 * a newer trigger cancels this await mid-flight. We race the font-ready
 * promise against the abort event so a never-resolving font promise still
 * surfaces cancellation (otherwise a mid-flight abort would hang forever
 * waiting for fonts to settle). The abort listener is registered with
 * `{ once: true }` so it self-cleans after firing.
 */
export declare function awaitFontsReady(signal: AbortSignal): Promise<void>;
/**
 * whenFontsReady — the non-measurement consumers' gate (issue #101: the
 * shell's idle-deferred library read starts only after fonts settle, so an
 * idle gap can never fire inside the ACPT-04 cold phase's font wait).
 * Resolves at once where the FontFaceSet API is absent (jsdom, engines
 * without `document.fonts`) — nothing to wait for there. No abort wiring:
 * callers gate with their own cancelled flag after the await.
 */
export declare function whenFontsReady(): Promise<void>;
