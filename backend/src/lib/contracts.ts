import { TableItem, queryByPk, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { conflict } from "../http/errors";

/**
 * Contracts hold billing terms for one engagement between an issuer (the
 * user, or a Work Area such as PIN) and a client — see
 * CLIENTS-INVOICING.md.
 */
export const BILLING_MODES = ["invoiced", "tracking"] as const;
export const PAY_UNITS = ["hourly", "flat", "per-project"] as const;
export const FLAT_RATE_PERIODS = ["monthly", "one-time"] as const;
export const TOKEN_BILLING = ["passthrough", "included"] as const;
export const DEFAULT_TOKEN_BILLING: ContractFields["tokenBilling"] = "passthrough";
export const DEFAULT_TOKEN_MARKUP = 1;

export interface ContractFields {
  name: string;
  issuerAreaId: string;
  clientId: string;
  projectIds: string[];
  billingMode: (typeof BILLING_MODES)[number];
  payUnit: (typeof PAY_UNITS)[number];
  rate: number;
  flatRatePeriod: (typeof FLAT_RATE_PERIODS)[number];
  tokenBilling: (typeof TOKEN_BILLING)[number];
  tokenMarkup: number;
  startDate: string;
  endDate: string;
  archived: boolean;
}

/** Stands in for a missing endDate, so open-ended ranges compare as dates. */
const OPEN_END_DATE = "9999-12-31";

export function toContract(item: TableItem) {
  return {
    id: sortKeys.contract.idOf(item),
    name: item.name ?? null,
    issuerAreaId: item.issuerAreaId ?? null,
    clientId: item.clientId,
    projectIds: (item.projectIds as string[] | undefined) ?? [],
    billingMode: item.billingMode,
    payUnit: item.payUnit,
    rate: item.rate,
    flatRatePeriod: item.flatRatePeriod ?? null,
    tokenBilling: item.tokenBilling ?? DEFAULT_TOKEN_BILLING,
    tokenMarkup: item.tokenMarkup ?? DEFAULT_TOKEN_MARKUP,
    startDate: item.startDate,
    endDate: item.endDate ?? null,
    archived: item.archived ?? false,
  };
}

type DateRange = { startDate: string; endDate?: string | null };

/** Whether a contract's date range includes `date`, both ends inclusive. */
export function coversDate(range: DateRange, date: string): boolean {
  return range.startDate <= date && date <= (range.endDate ?? OPEN_END_DATE);
}

function dateRangeOf(contract: TableItem): DateRange {
  return {
    startDate: contract.startDate as string,
    endDate: contract.endDate as string | undefined,
  };
}

function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= (b.endDate ?? OPEN_END_DATE) && b.startDate <= (a.endDate ?? OPEN_END_DATE);
}

async function activeContracts(userId: string): Promise<TableItem[]> {
  const contracts = await queryByPk(userPk(userId), sortKeys.contract.prefix);
  return contracts.filter((contract) => !contract.archived);
}

/**
 * The active contracts covering a project on a date. There's at most one
 * per billing layer: the user billing PIN, and PIN billing its client.
 */
export async function contractsCovering(
  userId: string,
  projectId: string,
  date: string,
): Promise<TableItem[]> {
  return (await activeContracts(userId)).filter(
    (contract) =>
      (contract.projectIds as string[]).includes(projectId) &&
      coversDate(dateRangeOf(contract), date),
  );
}

/**
 * Within one billing layer — the same issuer and project — contract date
 * ranges may not overlap, or the same work would be billed twice.
 */
export async function assertNoOverlappingContract(
  userId: string,
  contractId: string,
  candidate: Pick<ContractFields, "projectIds" | "startDate"> &
    Partial<Pick<ContractFields, "issuerAreaId" | "endDate">>,
): Promise<void> {
  const clash = (await activeContracts(userId)).find(
    (contract) =>
      sortKeys.contract.idOf(contract) !== contractId &&
      (contract.issuerAreaId ?? null) === (candidate.issuerAreaId ?? null) &&
      (contract.projectIds as string[]).some((id) => candidate.projectIds.includes(id)) &&
      rangesOverlap(dateRangeOf(contract), candidate),
  );
  if (clash) {
    throw conflict(
      `Overlaps contract ${sortKeys.contract.idOf(clash)}, which has the same issuer and project`,
    );
  }
}

/** The terms a time entry records at the moment it's logged. */
export function snapshotOf(contract: TableItem) {
  const terms = toContract(contract);
  return {
    contractId: terms.id,
    issuerAreaId: terms.issuerAreaId,
    clientId: terms.clientId,
    billingMode: terms.billingMode,
    payUnit: terms.payUnit,
    rate: terms.rate,
    tokenBilling: terms.tokenBilling,
    tokenMarkup: terms.tokenMarkup,
  };
}

export type ContractSnapshot = ReturnType<typeof snapshotOf>;
