const ZOTERO_USER_AGENT = 'OpenAlex-Count/1.0';

/**
 * Build standard headers for Zotero API requests. If an apiKey is provided,
 * use documented API-key authentication headers.
 */
export function buildZoteroHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': ZOTERO_USER_AGENT,
    'Zotero-API-Version': '3',
  };

  if (apiKey) {
    headers['Zotero-API-Key'] = apiKey;
  }

  return headers;
} 
