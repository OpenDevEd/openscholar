"use server";
import OpenAlexClient from "@/lib/openalex";

export async function startSearch(formData: FormData) {
    const query = formData.get('query') as string;
    const results = await OpenAlexClient.works({
        search: query,
    });
    return results.meta.count;
}

