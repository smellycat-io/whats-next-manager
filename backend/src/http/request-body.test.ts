import { describe, expect, it } from "vitest";
import { bodyOf, pickDefinedFields } from "./request-body";

describe("pickDefinedFields", () => {
  it("keeps listed fields that are present and drops everything else", () => {
    const body = { name: "Rent", order: 2, pk: "USER#someone-else", note: undefined };
    expect(pickDefinedFields(body, ["name", "order", "note"])).toEqual({
      name: "Rent",
      order: 2,
    });
  });

  it("keeps falsy values that are explicitly set", () => {
    expect(pickDefinedFields({ completed: false, order: 0 }, ["completed", "order"])).toEqual({
      completed: false,
      order: 0,
    });
  });
});

describe("bodyOf", () => {
  it("treats a missing body as empty", () => {
    expect(bodyOf(undefined)).toEqual({});
  });
});
