import { jsonrepair } from 'jsonrepair'

export function validateQuery(query: string): string {
  const openParens = (query.match(/\(/g) || []).length
  const closeParens = (query.match(/\)/g) || []).length

  if (openParens !== closeParens) {
    throw new Error('Generated query has unbalanced parentheses')
  }

  if (/OR\s*$|AND\s*$|NOT\s*$/.test(query)) {
    throw new Error('Generated query ends with an incomplete operator')
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