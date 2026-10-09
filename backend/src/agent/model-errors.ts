/** Diagnostics contain codes only, never provider bodies, prompts or credentials. */
export type ModelFailureCode = 'http' | 'network' | 'invalid_json' | 'too_large' | 'malformed_call' | 'output_limit' | 'blocked' | 'empty_response' | 'identity';
export class ModelFailure extends Error {
  constructor(readonly code: ModelFailureCode, readonly status?: number) {
    super(status ? `Model service returned HTTP ${status}.` : `Model response failed: ${code}.`);
  }
  get retryable() {
    return this.code === 'network' || this.code === 'malformed_call' || this.code === 'output_limit'
      || this.code === 'empty_response' || this.code === 'invalid_json'
      || (this.code === 'http' && [429,500,502,503,504].includes(this.status ?? 0));
  }
  get userMessage() {
    if (this.code === 'blocked') return 'The model could not answer this request under its safety rules. You can review the authorized records in the app.';
    if (this.code === 'identity' || this.status === 401 || this.status === 403) return 'The AI connection needs administrator attention. Your school records are still available in the app.';
    if (this.status === 429) return 'The AI service is busy or has reached its provider limit. Please try again shortly. No school action was retried.';
    if (this.code === 'output_limit' || this.code === 'too_large') return 'The AI could not finish this analysis within its limit. Please split it into a smaller question. No school action was retried.';
    return 'The AI could not produce a valid answer after recovery. Please try again or open the checked sources. No school action was retried.';
  }
}
export type ModelDiagnostic = { code: ModelFailureCode; status?: number; attempt: number; retrying: boolean };
