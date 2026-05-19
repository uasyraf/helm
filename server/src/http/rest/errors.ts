export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const httpErrors = {
  badRequest: (message: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", message, details),
  unauthorized: (message = "missing or invalid token") => new HttpError(401, "UNAUTHORIZED", message),
  forbidden: (message: string) => new HttpError(403, "FORBIDDEN", message),
  notFound: (message: string) => new HttpError(404, "NOT_FOUND", message),
  conflict: (message: string) => new HttpError(409, "CONFLICT", message),
};

export function toBody(err: HttpError): ErrorBody {
  return { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } };
}
