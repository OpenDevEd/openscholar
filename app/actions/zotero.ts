'use server';

import { buildZoteroHeaders } from '@/lib/zotero-utils';

/**
 * Retrieve the extracted full-text content that Zotero stores for an attachment.
 * Returns the plain text (or null on failure/404).
 */
export async function getZoteroFullText({ groupId, itemKey, apiKey }: { groupId: string; itemKey: string; apiKey: string }): Promise<string | null> {
  try {
    const path = `https://api.zotero.org/groups/${groupId}/items/${itemKey}/fulltext`;
    const res = await fetch(path, {
      headers: buildZoteroHeaders(apiKey),
    });

    if (!res.ok) {
      console.warn(`Zotero full-text fetch failed: ${res.status}`);
      return null;
    }

    const json = (await res.json()) as { content?: string };
    return typeof json?.content === 'string' && json.content.length ? json.content : null;
  } catch (err) {
    console.error('Error fetching Zotero full-text', err);
    return null;
  }
} 