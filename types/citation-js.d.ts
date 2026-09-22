declare module "@citation-js/core" {
    export class Cite {
        constructor(input: unknown);
        static async(input: unknown): Promise<Cite>;
        data: Record<string, unknown>[];
        format(format: "bibtex" | "ris", options?: Record<string, unknown>): string;
    }
}
declare module "@citation-js/plugin-bibtex" {}
