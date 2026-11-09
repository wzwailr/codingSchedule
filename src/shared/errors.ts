export class ProtocolError extends Error {
  constructor(public readonly code: string, public readonly status: number, detail?: string) {
    super(detail ? code + ': ' + detail : code);
    this.name = 'ProtocolError';
  }
}
export function fail(code: string, status = 409): never { throw new ProtocolError(code, status); }
