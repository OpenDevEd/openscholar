import { jsonrepair } from 'jsonrepair'
import { hasWildcardInQuotedPhrase } from '../../search/wildcard'

/**
 * An OQL query the search box takes: the part after `works where`. OQL keeps
 * wildcards inside quotes, the opposite of the classic rule.
 */
export function validateOqlQuery(query: string): string {
  const where = query.trim().replace(/^works\s+where\s+/i, '')
  const openParens = (where.match(/\(/g) || []).length
  const closeParens = (where.match(/\)/g) || []).length
  if (openParens !== closeParens) {
    throw new Error('Generated query has unbalanced parentheses')
  }
  if (/\b(and|or|not)\s*$/i.test(where)) {
    throw new Error('Generated query ends with an incomplete operator')
  }
  return where
}

export function validateQuery(query: string): string {
  const openParens = (query.match(/\(/g) || []).length
  const closeParens = (query.match(/\)/g) || []).length

  if (openParens !== closeParens) {
    throw new Error('Generated query has unbalanced parentheses')
  }

  if (/OR\s*$|AND\s*$|NOT\s*$/.test(query)) {
    throw new Error('Generated query ends with an incomplete operator')
  }

  // OpenAlex rejects a wildcard inside a quoted phrase ("contextual support*").
  // Fail validation so the op retries and re-prompts the model to fix it.
  if (hasWildcardInQuotedPhrase(query)) {
    throw new Error('Generated query has a wildcard (* or ?) inside a quoted phrase')
  }

  return query
}

export async function repairJSON(text: string, _error: unknown): Promise<string | null> {
  try {
    if (!text.trim().startsWith('{')) {
      return text.trim()
    }

    const repaired = jsonrepair(text)
    return repaired
  } catch {
    if (typeof text === 'string' && text.trim().length > 0 && !text.trim().startsWith('{')) {
      return text.trim()
    }

    return null
  }
}

export async function repairSingleField(text: string, error: unknown, fieldName: string): Promise<string | null> {
  const result = await repairJSON(text, error)
  if (result === null) return null

  if (!result.startsWith('{')) {
    return JSON.stringify({ [fieldName]: result })
  }

  return result
}