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

export async function repairJSON(text: string, error: any): Promise<string | null> {
  try {
    console.log('Attempting to repair text:', text)
    console.log('Parse error:', error)

    if (!text.trim().startsWith('{')) {
      console.log('Wrapped plain text as JSON')
      return text.trim()
    }

    const repaired = jsonrepair(text)
    console.log('Repaired JSON:', repaired)
    return repaired
  } catch (repairError) {
    console.error('JSON repair failed:', repairError)

    if (typeof text === 'string' && text.trim().length > 0 && !text.trim().startsWith('{')) {
      return text.trim()
    }

    return null
  }
}

export async function repairSingleField(text: string, error: any, fieldName: string): Promise<string | null> {
  const result = await repairJSON(text, error)
  if (result === null) return null

  if (!result.startsWith('{')) {
    return JSON.stringify({ [fieldName]: result })
  }

  return result
}

export function logAIError(context: string, error: unknown): void {
  console.error(`Error in ${context}:`, error)

  if (error && typeof error === 'object') {
    if ('cause' in error) {
      console.error('Error cause:', error.cause)
    }
    if ('text' in error) {
      console.error('Model output text:', error.text)
    }
  }
}