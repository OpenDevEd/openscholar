export const ZOTERO_USER_AGENT = 'OpenAlex-Count/1.0';

/**
 * Build standard headers for Zotero API requests. If an apiKey is provided,
 * both header-based and Bearer authentication are added for maximum
 * compatibility with various endpoints and redirect patterns.
 */
export function buildZoteroHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': ZOTERO_USER_AGENT,
    'Zotero-API-Version': '3',
  };

  if (apiKey) {
    headers['Zotero-API-Key'] = apiKey;      // legacy clients still rely on this
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Quick check whether a URL points to a Zotero attachment file endpoint.
 */
export function isZoteroFileUrl(url: string): boolean {
  return url.includes('api.zotero.org/') && url.includes('/file');
} 