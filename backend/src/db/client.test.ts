import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteItem, docClient, updateItem } from "./client";

const conditionFailed = () =>
  new ConditionalCheckFailedException({ message: "The conditional request failed", $metadata: {} });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateItem", () => {
  it("only updates items that already exist", async () => {
    const send = vi.spyOn(docClient, "send").mockResolvedValue({ Attributes: { pk: "p", sk: "s" } } as never);
    await updateItem("p", "s", { name: "x" });
    expect(send.mock.calls[0][0].input).toMatchObject({ ConditionExpression: "attribute_exists(pk)" });
  });

  it("returns undefined instead of creating a missing item", async () => {
    vi.spyOn(docClient, "send").mockRejectedValue(conditionFailed() as never);
    await expect(updateItem("p", "missing", { name: "x" })).resolves.toBeUndefined();
  });

  it("rethrows other storage errors", async () => {
    vi.spyOn(docClient, "send").mockRejectedValue(new Error("throttled") as never);
    await expect(updateItem("p", "s", { name: "x" })).rejects.toThrow("throttled");
  });
});

describe("deleteItem", () => {
  it("returns false when the item doesn't exist", async () => {
    vi.spyOn(docClient, "send").mockRejectedValue(conditionFailed() as never);
    await expect(deleteItem("p", "missing")).resolves.toBe(false);
  });

  it("returns true when the item is deleted", async () => {
    vi.spyOn(docClient, "send").mockResolvedValue({} as never);
    await expect(deleteItem("p", "s")).resolves.toBe(true);
  });
});

describe("updateItem onlyIf", () => {
  it("adds each onlyIf attribute to the existence condition", async () => {
    const send = vi.spyOn(docClient, "send").mockResolvedValue({ Attributes: { pk: "p", sk: "s" } } as never);
    await updateItem("p", "s", { agentState: "claimed" }, { agentState: "queued" });
    expect(send.mock.calls[0][0].input).toMatchObject({
      ConditionExpression: "attribute_exists(pk) AND #c0 = :c0",
      ExpressionAttributeNames: { "#f0": "agentState", "#c0": "agentState" },
      ExpressionAttributeValues: { ":v0": "claimed", ":c0": "queued" },
    });
  });
});
