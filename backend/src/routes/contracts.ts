import { Router } from "express";
import { randomUUID } from "crypto";
import { requireUserId } from "../auth/current-user";
import {
  TableItem,
  deleteItem,
  getItem,
  putItem,
  queryByPk,
  updateItem,
  userPk,
} from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest, notFound } from "../http/errors";
import {
  assertIsoDate,
  assertNonNegativeNumber,
  assertOneOf,
  bodyOf,
  pickDefinedFields,
} from "../http/request-body";
import { getAreas, kindOf } from "../lib/areas";
import {
  BILLING_MODES,
  ContractFields,
  DEFAULT_TOKEN_BILLING,
  DEFAULT_TOKEN_MARKUP,
  FLAT_RATE_PERIODS,
  PAY_UNITS,
  TOKEN_BILLING,
  assertNoOverlappingContract,
  toContract,
} from "../lib/contracts";

const UPDATABLE_FIELDS = [
  "name",
  "issuerAreaId",
  "clientId",
  "projectIds",
  "billingMode",
  "payUnit",
  "rate",
  "flatRatePeriod",
  "tokenBilling",
  "tokenMarkup",
  "startDate",
  "endDate",
  "archived",
] as const satisfies readonly (keyof ContractFields)[];

const REQUIRED_MESSAGE = "clientId, projectIds, billingMode, payUnit, rate and startDate are required";

/** Field shapes and the rules between them, before any lookups. */
function assertValidTerms(contract: Partial<ContractFields>): void {
  const { clientId, projectIds, billingMode, payUnit, rate, startDate, endDate } = contract;
  if (!clientId || !projectIds?.length || !billingMode || !payUnit || rate === undefined || !startDate) {
    throw badRequest(REQUIRED_MESSAGE);
  }
  assertOneOf(billingMode, BILLING_MODES, "billingMode");
  assertOneOf(payUnit, PAY_UNITS, "payUnit");
  assertOneOf(contract.flatRatePeriod, FLAT_RATE_PERIODS, "flatRatePeriod");
  assertOneOf(contract.tokenBilling, TOKEN_BILLING, "tokenBilling");
  assertNonNegativeNumber(rate, "rate");
  assertNonNegativeNumber(contract.tokenMarkup, "tokenMarkup");
  assertIsoDate(startDate, "startDate");
  assertIsoDate(endDate, "endDate");
  if (endDate && endDate < startDate) throw badRequest("endDate must not be before startDate");
  if (payUnit === "flat" && !contract.flatRatePeriod) {
    throw badRequest("flatRatePeriod is required for flat contracts");
  }
  if (payUnit !== "flat" && contract.flatRatePeriod) {
    throw badRequest("flatRatePeriod only applies to flat contracts");
  }
}

/** The client and projects must exist, and an issuer must be a Work Area. */
async function assertReferencesExist(userId: string, contract: Partial<ContractFields>): Promise<void> {
  const pk = userPk(userId);
  const [client, ...projects] = await Promise.all([
    getItem(pk, sortKeys.client.for(contract.clientId as string)),
    ...(contract.projectIds as string[]).map((id) => getItem(pk, sortKeys.project.for(id))),
  ]);
  if (!client) throw badRequest("clientId does not match a client");
  if (projects.some((project) => !project)) throw badRequest("projectIds include an unknown project");

  if (contract.issuerAreaId) {
    const [issuer] = await getAreas(userId, [contract.issuerAreaId]);
    if (!issuer || kindOf(issuer) !== "work") throw badRequest("issuerAreaId must be a Work Area");
  }
}

async function assertValidContract(
  userId: string,
  contractId: string,
  contract: Partial<ContractFields>,
): Promise<void> {
  assertValidTerms(contract);
  await assertReferencesExist(userId, contract);
  if (!contract.archived) {
    await assertNoOverlappingContract(userId, contractId, contract as ContractFields);
  }
}

/** An update's `null` clears a field, so it drops out of the merged contract. */
function withoutNulls(fields: Record<string, unknown>): Partial<ContractFields> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null));
}

export const contractsRouter = Router();
contractsRouter.use(requireUserId);

contractsRouter.get("/", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), sortKeys.contract.prefix);
  res.json(items.map(toContract));
});

contractsRouter.post("/", async (req, res) => {
  const contractId = randomUUID();
  const fields = pickDefinedFields(bodyOf<ContractFields>(req.body), UPDATABLE_FIELDS);
  const contract = {
    tokenBilling: DEFAULT_TOKEN_BILLING,
    tokenMarkup: DEFAULT_TOKEN_MARKUP,
    ...withoutNulls(fields),
  };
  await assertValidContract(req.userId, contractId, contract);

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.contract.for(contractId),
    type: "CONTRACT",
    ...contract,
  };
  await putItem(item);
  res.status(201).json(toContract(item));
});

// Validates the contract as it will be after the update, not just the
// fields sent, so rules spanning fields (flat needs a period, no overlap)
// still hold.
contractsRouter.put("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const sk = sortKeys.contract.for(req.params.id);
  const existing = await getItem(pk, sk);
  if (!existing) throw notFound("Contract");

  const updates = pickDefinedFields(bodyOf<ContractFields>(req.body), UPDATABLE_FIELDS);
  await assertValidContract(req.userId, req.params.id, withoutNulls({ ...existing, ...updates }));

  const updated = await updateItem(pk, sk, updates);
  if (!updated) throw notFound("Contract");
  res.json(toContract(updated));
});

// Once any entry has been invoiced under a contract, deleting it would
// rewrite billing history, so it's archived instead.
contractsRouter.delete("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const sk = sortKeys.contract.for(req.params.id);
  const entries = await queryByPk(pk, sortKeys.timeEntry.prefix);
  const hasInvoicedEntries = entries.some((entry) =>
    ((entry.invoicedContractIds as string[] | undefined) ?? []).includes(req.params.id),
  );

  if (hasInvoicedEntries) {
    const archived = await updateItem(pk, sk, { archived: true });
    if (!archived) throw notFound("Contract");
    res.json(toContract(archived));
    return;
  }

  const deleted = await deleteItem(pk, sk);
  if (!deleted) throw notFound("Contract");
  res.status(204).send();
});
