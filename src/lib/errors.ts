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
// 503: a part of the server this needs is not configured.
export class NotSetUpError extends AppError {
  status = 503;
}
// 409: the record is not in a state where this can happen.
export class ConflictError extends AppError {
  status = 409;
}

// A Postgres error as the error the user should see: a value already used, a value in the wrong format, a record in use.
export function fromDatabase(e: unknown): AppError | null {
  const pg = e as { code?: string; constraint?: string };
  if (pg?.code === "23505") return new ConflictError(pg.constraint === "users_email_key" ? "Another user already has that email." : "A record with that id or value already exists.");
  if (pg?.code === "22P02" || pg?.code === "22003" || pg?.code === "22007" || pg?.code === "22008") return new ValidationError("A value has the wrong format.");
  if (pg?.code === "23503") return new ConflictError("This refers to a record that does not exist, or is used by other records.");
  if (pg?.code === "23514") return new ValidationError("A value is not one of the allowed choices.");
  return null;
}
