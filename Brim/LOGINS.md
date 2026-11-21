# Demo logins

Every Harborline user logs in at `/login` with their email and the demo password **`harborline`**. This assumes `scripts/seed-harborline.ts` has been run. If `SEED_PASSWORD` was set when it ran, the password is that value instead.

Source: `brim_ap_dataset/data/users.csv`.

## Notes

- **Noah Park** (U015) is terminated, so his login is refused (`src/lib/auth/service.ts`).
- **Liam O'Connor** (U012) is on leave; his approvals go to his delegate, Elise Tremblay (U003).
- **Brim staff `/admin`** has no seeded login. Create one with `npm run script -- scripts/create-brim-staff.ts <email> "<name>" <password>`.

## Users

| ID | Name | Email | Title | Role | Approval limit (CAD) | Status |
|---|---|---|---|---|---|---|
| U001 | Priya Raman | `priya.raman@harborline-logistics.example` | Chief Financial Officer | controller_admin | 500,000 | active |
| U002 | Marcus Webb | `marcus.webb@harborline-logistics.example` | Controller | controller_admin | 250,000 | active |
| U003 | Elise Tremblay | `elise.tremblay@harborline-logistics.example` | Finance Manager | finance_manager | 50,000 | active |
| U004 | Jordan Okafor | `jordan.okafor@harborline-logistics.example` | AP Clerk | ap_clerk | — | active |
| U005 | Sam Patel | `sam.patel@harborline-logistics.example` | AP Clerk | ap_clerk | — | active |
| U006 | Hannah Lindqvist | `hannah.lindqvist@harborline-logistics.example` | Internal Auditor | auditor | — | active |
| U007 | Dev Malhotra | `dev.malhotra@harborline-logistics.example` | Operations Manager | approver | 10,000 | active |
| U008 | Chloe Bergeron | `chloe.bergeron@harborline-logistics.example` | Sales Director | approver | 10,000 | active |
| U009 | Tomas Alvarez | `tomas.alvarez@harborline-logistics.example` | Marketing Manager | approver | 10,000 | active |
| U010 | Wen Zhao | `wen.zhao@harborline-logistics.example` | IT Manager | approver | 10,000 | active |
| U011 | Grace Mbeki | `grace.mbeki@harborline-logistics.example` | People & Culture Manager | approver | 10,000 | active |
| U012 | Liam O'Connor | `liam.o.connor@harborline-logistics.example` | Facilities Manager | approver | 10,000 | on_leave |
| U013 | Aiden Grant | `aiden.grant@harborline-logistics.example` | Dispatcher | employee | — | active |
| U014 | Farid Fraser | `farid.fraser@harborline-logistics.example` | Fleet Coordinator | employee | — | active |
| U015 | Noah Park | `noah.park@harborline-logistics.example` | Dispatcher | employee | — | terminated |
| U016 | Wyatt Mitchell | `wyatt.mitchell@harborline-logistics.example` | Warehouse Lead | employee | — | active |
| U017 | Camille Dubois | `camille.dubois@harborline-logistics.example` | Warehouse Lead | employee | — | active |
| U018 | Amara Walker | `amara.walker@harborline-logistics.example` | Fleet Coordinator | employee | — | active |
| U019 | Stefan Haddad | `stefan.haddad@harborline-logistics.example` | Logistics Analyst | employee | — | active |
| U020 | Mei Walker | `mei.walker@harborline-logistics.example` | Warehouse Lead | employee | — | active |
| U021 | Ben Sokolov | `ben.sokolov@harborline-logistics.example` | Logistics Analyst | employee | — | active |
| U022 | Noah Kowalski | `noah.kowalski@harborline-logistics.example` | Customer Success Manager | employee | — | active |
| U023 | Mei Mitchell | `mei.mitchell@harborline-logistics.example` | Sales Development Rep | employee | — | active |
| U024 | Olivia Bhatt | `olivia.bhatt@harborline-logistics.example` | Sales Development Rep | employee | — | active |
| U025 | Stefan Reyes | `stefan.reyes@harborline-logistics.example` | Account Executive | employee | — | active |
| U026 | Stefan Hussain | `stefan.hussain@harborline-logistics.example` | Account Executive | employee | — | active |
| U027 | Isla Morrison | `isla.morrison@harborline-logistics.example` | Marketing Specialist | employee | — | active |
| U028 | Noah Haddad | `noah.haddad@harborline-logistics.example` | Content Designer | employee | — | active |
| U029 | Zane Reyes | `zane.reyes@harborline-logistics.example` | Content Designer | employee | — | active |
| U030 | Camille Campbell | `camille.campbell@harborline-logistics.example` | Accountant | employee | — | active |
| U031 | Elena Bouchard | `elena.bouchard@harborline-logistics.example` | Developer | employee | — | active |
| U032 | Noah Singh | `noah.singh@harborline-logistics.example` | Systems Administrator | employee | — | active |
| U033 | Wyatt Lavoie | `wyatt.lavoie@harborline-logistics.example` | Support Analyst | employee | — | active |
| U034 | Umar Nguyen | `umar.nguyen@harborline-logistics.example` | Developer | employee | — | active |
| U035 | Wyatt Bhatt | `wyatt.bhatt@harborline-logistics.example` | Recruiter | employee | — | active |
| U036 | Olivia Singh | `olivia.singh@harborline-logistics.example` | HR Generalist | employee | — | active |
| U037 | Kavya Morrison | `kavya.morrison@harborline-logistics.example` | Maintenance Technician | employee | — | active |
| U038 | Olivia Kowalski | `olivia.kowalski@harborline-logistics.example` | Facilities Coordinator | employee | — | active |
| U039 | Yara Bouchard | `yara.bouchard@harborline-logistics.example` | Maintenance Technician | employee | — | active |
| U040 | Elena Hussain | `elena.hussain@harborline-logistics.example` | Executive Assistant | employee | — | active |
