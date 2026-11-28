import { beforeEach, describe, expect, it, vi } from "vitest";
import { TableItem, getItem, queryByPk } from "../db/client";
import { assertAtMostOneWorkArea, assertCanBecomeWorkArea } from "./areas";

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  getItem: vi.fn(),
  queryByPk: vi.fn(),
}));

const USER_ID = "user";
const area = (id: string, kind?: string): TableItem => ({ pk: `USER#${USER_ID}`, sk: `AREA#${id}`, kind });
const AREAS: Record<string, TableItem> = {
  pin: area("pin", "work"),
  acme: area("acme", "work"),
  personal: area("personal", "life"),
  whatsNext: area("whatsNext", "project"),
  legacy: area("legacy"),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getItem).mockImplementation(async (_pk, sk) => AREAS[sk.slice("AREA#".length)]);
});

describe("assertAtMostOneWorkArea", () => {
  it("allows one Work Area alongside Life and Project Areas", async () => {
    await expect(
      assertAtMostOneWorkArea(USER_ID, ["pin", "personal", "whatsNext"]),
    ).resolves.toBeUndefined();
  });

  it("rejects two Work Areas", async () => {
    await expect(assertAtMostOneWorkArea(USER_ID, ["pin", "acme"])).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("counts a repeated Work Area once", async () => {
    await expect(assertAtMostOneWorkArea(USER_ID, ["pin", "pin"])).resolves.toBeUndefined();
  });

  it("treats an Area with no kind as a Life Area", async () => {
    await expect(assertAtMostOneWorkArea(USER_ID, ["pin", "legacy"])).resolves.toBeUndefined();
  });
});

describe("assertCanBecomeWorkArea", () => {
  function withItems(projects: TableItem[], tasks: TableItem[] = []) {
    vi.mocked(queryByPk).mockImplementation(async (_pk, prefix) => {
      if (prefix === "AREA#") return Object.values(AREAS);
      if (prefix === "PROJECT#") return projects;
      return tasks;
    });
  }

  it("rejects when a project already has this Area and another Work Area", async () => {
    withItems([{ pk: "p", sk: "PROJECT#1", areaIds: ["pin", "personal"] }]);
    await expect(assertCanBecomeWorkArea(USER_ID, "personal")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("rejects when a task already has this Area and another Work Area", async () => {
    withItems([], [{ pk: "p", sk: "TASK#1", areaIds: ["whatsNext", "acme"] }]);
    await expect(assertCanBecomeWorkArea(USER_ID, "whatsNext")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("allows it when no item pairs this Area with another Work Area", async () => {
    withItems([
      { pk: "p", sk: "PROJECT#1", areaIds: ["personal"] },
      { pk: "p", sk: "PROJECT#2", areaIds: ["pin", "whatsNext"] },
    ]);
    await expect(assertCanBecomeWorkArea(USER_ID, "personal")).resolves.toBeUndefined();
  });
});
