// citeproc-ts currently publishes JavaScript without declarations.
declare module "citeproc-ts" {
	export const CSL: {
		Engine: new (sys: {
			retrieveItem: (id: string) => Record<string, unknown>;
			retrieveLocale: (locale: string) => unknown;
		}, style: unknown, locale?: string) => {
			opt: { development_extensions: { wrap_url_and_doi: boolean } };
			setOutputFormat(format: "text" | "html"): void;
			updateItems(ids: string[]): void;
			makeCitationCluster(items: { id: string }[]): string;
			makeBibliography(): [Record<string, unknown>, string[]] | false;
		};
	};
}
