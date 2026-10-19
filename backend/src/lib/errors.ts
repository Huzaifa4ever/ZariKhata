export class AppError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message);
  }
  static forbidden(message = 'You do not have permission to do this') {
    return new AppError(403, message);
  }
  static notFound(message = 'Not found') {
    return new AppError(404, message);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError(409, message, details);
  }
}
