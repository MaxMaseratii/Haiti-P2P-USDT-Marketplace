export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}
export const bad = (m, c) => new HttpError(400, m, c);
export const unauth = (m = 'Login needed') => new HttpError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'Not allowed') => new HttpError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'NOT_FOUND');
export const conflict = (m, c) => new HttpError(409, m, c || 'CONFLICT');
