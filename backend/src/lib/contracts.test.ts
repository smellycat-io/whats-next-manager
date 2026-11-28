import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTable } from "../test-support/fake-table";
import { assertNoOverlappingContract, contractsCovering, coversDate } from "./contracts";

vi.mock("../db/client", () => import("../test-support/fake-table"));

const pk = "USER#user";
const contract = (id: string, fields: Record<string, unknown>) => ({
  pk,
  sk: `CONTRACT#${id}`,
  projectIds: ["maf"],
  startDate: "2026-01-01",
  ...fields,
});

describe("coversDate", () => {
  it("includes both ends of the range", () => {
    const range = { startDate: "2026-01-01", endDate: "2026-01-31" };
    expect(coversDate(range, "2026-01-01")).toBe(true);
    expect(coversDate(range, "2026-01-31")).toBe(true);
    expect(coversDate(range, "2026-02-01")).toBe(false);
  });

  it("treats a missing endDate as open-ended", () => {
    expect(coversDate({ startDate: "2026-01-01" }, "2031-06-15")).toBe(true);
  });
});

describe("contractsCovering", () => {
  it("finds one contract per billing layer, skipping archived and out-of-range ones", async () => {
    resetTable([
      contract("user-to-pin", {}),
      contract("pin-to-maf", { issuerAreaId: "pin" }),
      contract("expired", { issuerAreaId: "pin", endDate: "2025-12-31", startDate: "2025-01-01" }),
      contract("archived", { archived: true }),
      contract("other-project", { projectIds: ["internal"] }),
    ]);
    const covering = await contractsCovering("user", "maf", "2026-03-01");
    expect(covering.map((c) => c.sk).sort()).toEqual(["CONTRACT#pin-to-maf", "CONTRACT#user-to-pin"]);
  });
});

describe("assertNoOverlappingContract", () => {
  beforeEach(() => {
    resetTable([contract("existing", { issuerAreaId: "pin", endDate: "2026-06-30" })]);
  });

  it("rejects an overlapping range for the same issuer and project", async () => {
    await expect(
      assertNoOverlappingContract("user", "new", {
        issuerAreaId: "pin",
        projectIds: ["maf"],
        startDate: "2026-06-01",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("allows the other billing layer to cover the same dates", async () => {
    await expect(
      assertNoOverlappingContract("user", "new", { projectIds: ["maf"], startDate: "2026-01-01" }),
    ).resolves.toBeUndefined();
  });

  it("allows a renewal that starts after the old contract ends", async () => {
    await expect(
      assertNoOverlappingContract("user", "renewal", {
        issuerAreaId: "pin",
        projectIds: ["maf"],
        startDate: "2026-07-01",
      }),
    ).resolves.toBeUndefined();
  });

  it("doesn't count a contract as overlapping itself", async () => {
    await expect(
      assertNoOverlappingContract("user", "existing", {
        issuerAreaId: "pin",
        projectIds: ["maf"],
        startDate: "2026-02-01",
      }),
    ).resolves.toBeUndefined();
  });
});
