// citeproc-ts currently publishes JavaScript without declarations.
declare module "citeproc-ts" {
	export const CSL: {
		Engine: new (sys: {
			retrieveItem: (id: string) => Record<string, unknown>;
			retrieveLocale: (locale: string) => unknown;
		}, style: unknown, locale?: string) => {
			setOutputFormat(format: "text" | "html"): void;
			updateItems(ids: string[]): void;
			makeCitationCluster(items: { id: string }[]): string;
			makeBibliography(): [Record<string, unknown>, string[]] | false;
		};
	};
}
