export declare const FONT_STACKS: {
    readonly serif: '"Literata", "Source Serif 4", Georgia, Charter, "Times New Roman", serif';
    readonly sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    readonly dyslexic: "Verdana, Tahoma, 'Segoe UI', Geneva, sans-serif";
};
export declare const SPACING_PRESETS: {
    readonly compact: {
        readonly lineHeight: 1.4;
        readonly letterSpacing: "0";
        readonly wordSpacing: "0";
    };
    readonly comfortable: {
        readonly lineHeight: 1.6;
        readonly letterSpacing: "0";
        readonly wordSpacing: "0";
    };
    readonly spacious: {
        readonly lineHeight: 1.8;
        readonly letterSpacing: "0.01em";
        readonly wordSpacing: "0.05em";
    };
};
export declare const SIZE_STEPS: readonly [16, 18, 20, 22, 24];
export declare const MEASURE_STEPS: readonly [40, 46, 52, 58, 64, 70, 76, 82, 88];
export declare const RATE_STEPS: readonly [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
/** The visible form of a rate multiplier ("1", "1.5", "1.25") — the caller
 * appends the "×" so the transport bar and the settings readout stay
 * byte-identical. Shared so the two surfaces cannot drift. */
export declare function formatRate(rate: number): string;
