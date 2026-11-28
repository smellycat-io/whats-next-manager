import { TableItem } from "./client";

/**
 * One entity type's sort key, `<PREFIX><id>`, under the owner's
 * `USER#<id>` partition (see DATA-MODEL.md).
 */
export class SortKey {
  constructor(readonly prefix: string) {}

  for(id: string): string {
    return `${this.prefix}${id}`;
  }

  idOf(item: TableItem): string {
    return item.sk.slice(this.prefix.length);
  }
}

/** The one place each entity's sort-key prefix is spelled out. */
export const sortKeys = {
  area: new SortKey("AREA#"),
  delegate: new SortKey("DELEGATE#"),
  priorityLevel: new SortKey("PRIORITY_LEVEL#"),
  project: new SortKey("PROJECT#"),
  task: new SortKey("TASK#"),
} as const;
