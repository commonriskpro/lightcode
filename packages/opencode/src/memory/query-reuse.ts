export type RecallState = {
  query: string
  norm: string
}

function norm(txt?: string): string {
  return (txt ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export namespace QueryReuse {
  export function normalize(txt?: string): string {
    return norm(txt)
  }

  export function reuse(prev: RecallState | undefined, next?: string): boolean {
    const txt = norm(next)
    if (!prev || !txt) return false
    if (txt === prev.norm) return true
    if (txt.length > 80) return false
    if (txt.includes(prev.norm) || prev.norm.includes(txt)) return true
    return false
  }
}
