import { estimateTokenCount } from "tokenx"

export namespace Token {
  /**
   * Estimate the token count of a string using tokenx (~96% accuracy vs full
   * tokenizers, 2kB bundle, zero deps). Handles CJK, accented characters, and
   * TypeScript/code content correctly — significantly more accurate than chars/4.
   */
  export function estimate(input: string): number {
    if (!input) return 0
    return estimateTokenCount(input)
  }
}
