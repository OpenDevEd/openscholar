/**
 * Region Encoding/Decoding Utilities
 * 
 * Transforms between internal region IDs (lowercase with underscores) and 
 * compact URL codes for efficient URL parameters.
 * 
 * Examples:
 * - Internal: 'africa' → URL: 'AF'
 * - Internal: 'eastern_africa' → URL: 'AF_E'
 * - Internal: 'ZA' (country code) → URL: 'ZA'
 */

import { COUNTRIES } from '../constants';

/**
 * Map from internal region IDs (lowercase with underscores) to URL codes
 * Used for compact URL encoding
 */
export const INTERNAL_TO_URL_CODE: Record<string, string> = {
  // Continents
  'africa': 'AF',
  'americas': 'AM',
  'asia': 'AS',
  'europe': 'EU',
  'oceania': 'OC',
  'antarctica': 'AQ_R', // Use AQ_R to distinguish from AQ country code
  
  // Africa sub-regions
  'eastern_africa': 'AF_E',
  'middle_africa': 'AF_M',
  'northern_africa': 'AF_N',
  'southern_africa': 'AF_S',
  'western_africa': 'AF_W',
  
  // Americas sub-regions
  'caribbean': 'AM_CAR',
  'central_america': 'AM_C',
  'north_america': 'AM_N',
  'south_america': 'AM_S',
  
  // Asia sub-regions
  'central_asia': 'AS_C',
  'eastern_asia': 'AS_E',
  'south-eastern_asia': 'AS_SE',
  'southern_asia': 'AS_S',
  'western_asia': 'AS_W',
  
  // Europe sub-regions
  'eastern_europe': 'EU_E',
  'northern_europe': 'EU_N',
  'southern_europe': 'EU_S',
  'western_europe': 'EU_W',
  
  // Oceania sub-regions
  'australia_and_new_zealand': 'OC_ANZ',
  'melanesia': 'OC_MEL',
  'micronesia': 'OC_MIC',
  'polynesia': 'OC_POL',
};

/**
 * Reverse mapping: URL codes to internal IDs
 */
export const URL_CODE_TO_INTERNAL: Record<string, string> = Object.fromEntries(
  Object.entries(INTERNAL_TO_URL_CODE).map(([k, v]) => [v, k])
);

/**
 * Encode an array of region IDs and country codes into a compact URL string
 * Converts internal IDs (like 'africa') to URL codes (like 'AF')
 */
export function encodeRegions(selectedItems: string[]): string {
  if (!selectedItems || selectedItems.length === 0) return '';
  
  const result: string[] = [];
  
  for (const item of selectedItems) {
    const lowerItem = item.toLowerCase();
    
    // Check if this is an internal region ID that needs conversion
    const urlCode = INTERNAL_TO_URL_CODE[lowerItem];
    if (urlCode) {
      result.push(urlCode);
      continue;
    }
    
    // Check if it's a country code (2 letters)
    const upperItem = item.toUpperCase();
    if (upperItem.length === 2 && COUNTRIES[upperItem]) {
      result.push(upperItem);
      continue;
    }
    
    // Unknown item - skip
  }
  
  return result.join(',');
}

/**
 * Decode a compact URL string back into an array of internal region IDs and country codes
 * Converts URL codes (like 'AF') back to internal IDs (like 'africa')
 */
export function decodeRegions(encoded: string): string[] {
  if (!encoded || encoded.trim() === '') return [];
  
  const result: string[] = [];
  const parts = encoded.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim().toUpperCase();
    if (!trimmed) continue;
    
    // Check if it's a region code (continent or sub-region)
    const internalId = URL_CODE_TO_INTERNAL[trimmed];
    if (internalId) {
      result.push(internalId);
      continue;
    }
    
    // Check if it's a valid country code
    if (trimmed.length === 2 && COUNTRIES[trimmed]) {
      result.push(trimmed);
      continue;
    }
    
    // Ignore unknown codes
  }
  
  return [...new Set(result)];
}
