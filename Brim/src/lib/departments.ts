/**
 * Departments by name: the forms and tables store a department's code ("D01") but show its name
 * ("Operations"). Names come from the Department table (seeded from departments.csv).
 */
import { db } from "@/lib/db";

export interface DepartmentOption {
  id: string;
  name: string;
}

/**
 * The organization's departments, ordered by code. `extraIds` are codes in use elsewhere (on users)
 * with no Department row; they are listed under their code so nothing in use disappears.
 */
export async function listDepartments(organizationId: string, extraIds: Iterable<string | null> = []): Promise<DepartmentOption[]> {
  const rows = await db().department.findMany({
    where: { organizationId },
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  const known = new Set(rows.map((r) => r.id));
  const extras = [...new Set([...extraIds].filter((d): d is string => !!d && !known.has(d)))].map((id) => ({ id, name: id }));
  return [...rows, ...extras].sort((a, b) => a.id.localeCompare(b.id));
}

/** Code → name, falling back to the code. */
export function departmentNames(departments: readonly DepartmentOption[]): Record<string, string> {
  return Object.fromEntries(departments.map((d) => [d.id, d.name]));
}
