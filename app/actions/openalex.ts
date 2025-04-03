"use server";
import OpenAlexClient from "@/lib/openalex";
import { fields, type SearchField } from "@/lib/utils";

export async function startSearch(formData: FormData, searchField: SearchField) {
    const query = formData.get('query') as string;
    const results = await OpenAlexClient.works({
        search: query,
        searchField: searchField
    });
    return results.meta.count;
}

export async function getSearchResults(query: string, searchField: SearchField) {
    console.log("searchField", searchField);
    const results = await OpenAlexClient.works({
        search: query,
        perPage: 200,
        AbstractArrayToString: true,
        searchField: searchField
    });
    return results;
}
