// Errors the services raise; the API turns each into its HTTP status.
export class AppError extends Error {
  status = 500;
}
// 401: no signed-in user.
export class UnauthorizedError extends AppError {
  status = 401;
}
// 403: signed in, but this user may not do this.
export class ForbiddenError extends AppError {
  status = 403;
}
// 404: no such record in this organization.
export class NotFoundError extends AppError {
  status = 404;
}
// 400: the request itself is incomplete or not allowed in this form.
export class ValidationError extends AppError {
  status = 400;
}
// 409: the record is not in a state where this can happen.
export class ConflictError extends AppError {
  status = 409;
}
