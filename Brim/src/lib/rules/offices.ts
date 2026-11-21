/**
 * Harborline's four offices. The bill-to address is the only statement of where delivery was,
 * so it decides the province and therefore the tax (BUILD_PLAN "What the unsealed incoming batch looks like").
 */
import type { Province } from "../types";

export const OFFICES: ReadonlyArray<{ province: Province; address: string; city: string; postalPrefix: string }> = [
  { province: "ON", address: "88 Queens Quay W, Suite 1400, Toronto ON M5J 0B8", city: "Toronto", postalPrefix: "M" },
  { province: "BC", address: "1055 W Hastings St, Suite 900, Vancouver BC V6E 2E9", city: "Vancouver", postalPrefix: "V" },
  { province: "AB", address: "250 6 Ave SW, Suite 700, Calgary AB T2P 3H7", city: "Calgary", postalPrefix: "T" },
  { province: "QC", address: "1250 Rene-Levesque O, Bureau 2200, Montreal QC H3B 4W8", city: "Montreal", postalPrefix: "H" },
];

export const PROVINCE_NAMES: Record<Province, string> = {
  ON: "Ontario",
  BC: "British Columbia",
  AB: "Alberta",
  QC: "Quebec",
};

export function officeAddress(province: Province): string {
  return OFFICES.find((o) => o.province === province)!.address;
}
