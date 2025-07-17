'use server';

import { buildZoteroHeaders } from '@/lib/zotero-utils';

export async function getZoteroFileUrl({ groupId, childKey, apiKey }: { groupId: string; childKey: string; apiKey: string }): Promise<string | null> {
  if (!groupId || !childKey || !apiKey) return null;
  
  const headers = buildZoteroHeaders(apiKey);

  try {
    // Try direct GET first to see if Zotero serves the file without redirect issues
    const directPath = `https://api.zotero.org/groups/${groupId}/items/${childKey}/file`;
    const directRes = await fetch(directPath, {
      method: 'HEAD',
      redirect: 'manual', // Don't automatically follow redirects
      headers,
    });

    // If Zotero returns 302 Location we can still use the Zotero path (let the caller fetch with auth)
    if (directRes.status === 200) {
      return directPath;
    }

    if (directRes.status === 302) {
      // Some attachments redirect to S3 signed URLs. We still prefer to proxy through Zotero path to avoid external 403s
      return directPath;
    }

    // Fallback to query param method (legacy)
    const urlWithKey = `https://api.zotero.org/groups/${groupId}/items/${childKey}/file?key=${apiKey}`;
    const res = await fetch(urlWithKey, {
      method: 'HEAD',
      redirect: 'manual',
      headers: buildZoteroHeaders(),
    });

    if (res.ok || res.status === 302) {
      // Return Zotero path with query param — caller can fetch with auth header to minimise URL leakage
      return urlWithKey;
    }

    console.error(`Failed to get Zotero file URL for item ${childKey}:`, {
      directStatus: directRes.status,
      queryParamStatus: res.status,
    });

    return null;
  } catch (error) {
    console.error(`Error getting Zotero file URL for item ${childKey}:`, error);
    return null;
  }
} 

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