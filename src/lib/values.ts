// An empty form or JSON value is stored as NULL.
export const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
