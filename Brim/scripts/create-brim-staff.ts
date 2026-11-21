/**
 * Adds a Brim staff member, who can log in at /admin/login to onboard and manage organizations.
 *   npm run script -- scripts/create-brim-staff.ts <email> "<full name>" <password>
 */
import { createStaff } from "../src/lib/auth/service";

async function main() {
  const [email, fullName, password] = process.argv.slice(2);
  if (!email || !fullName || !password) {
    console.error('Usage: npm run script -- scripts/create-brim-staff.ts <email> "<full name>" <password>');
    process.exit(2);
  }
  const staff = await createStaff({ email, fullName, password });
  console.log(`Created Brim staff ${staff.email} (${staff.id}).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
