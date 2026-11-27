import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Single-table DynamoDB access layer (see DATA-MODEL.md). Every route
 * module reuses these generic helpers rather than calling the DynamoDB
 * SDK directly — one data-access layer, per CLAUDE.md's DRY/single-
 * responsibility rules.
 *
 * Table key names (`pk`/`sk`) and the GSI1 index name/shape mirror
 * infra/lib/constructs/database-construct.ts exactly.
 */

const TABLE_NAME = process.env.TABLE_NAME as string;
const GSI1_INDEX_NAME = "GSI1-sharedWorkspace";

// Guards updates and deletes. DynamoDB's UpdateItem otherwise creates the
// item when the key doesn't exist, which would leave a half-formed record
// with no `type`.
const ITEM_EXISTS = "attribute_exists(pk)";

const ddbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export type TableItem = Record<string, unknown> & { pk: string; sk: string };

/** The `USER#<id>` PK convention used throughout DATA-MODEL.md. */
export function userPk(userId: string): string {
  return `USER#${userId}`;
}

export async function getItem(
  pk: string,
  sk: string,
): Promise<TableItem | undefined> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    }),
  );
  return result.Item as TableItem | undefined;
}

export async function putItem(item: TableItem): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    }),
  );
}

/**
 * Applies `updates` to an existing item and returns the updated item, or
 * undefined when no item has that key. Never creates an item. A `null`
 * value removes the attribute.
 */
export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, unknown>,
): Promise<TableItem | undefined> {
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return getItem(pk, sk);
  }

  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};
  const setClauses: string[] = [];
  const removeClauses: string[] = [];

  keys.forEach((key, index) => {
    const nameToken = `#f${index}`;
    expressionAttributeNames[nameToken] = key;

    // null means "clear this attribute" — a plain SET to null would leave
    // a NULL-type value in place, which (unlike a genuinely absent
    // attribute) breaks sparse GSIs like GSI1 (see WORKSPACES.md), so an
    // explicit REMOVE is needed instead.
    if (updates[key] === null) {
      removeClauses.push(nameToken);
    } else {
      const valueToken = `:v${index}`;
      expressionAttributeValues[valueToken] = updates[key];
      setClauses.push(`${nameToken} = ${valueToken}`);
    }
  });

  const updateExpression = [
    setClauses.length > 0 ? `SET ${setClauses.join(", ")}` : null,
    removeClauses.length > 0 ? `REMOVE ${removeClauses.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return ifItemExists(async () => {
    const result = await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        UpdateExpression: updateExpression,
        ConditionExpression: ITEM_EXISTS,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues:
          Object.keys(expressionAttributeValues).length > 0
            ? expressionAttributeValues
            : undefined,
        ReturnValues: "ALL_NEW",
      }),
    );
    return result.Attributes as TableItem;
  });
}

/** Deletes an item. Returns false when no item has that key. */
export async function deleteItem(pk: string, sk: string): Promise<boolean> {
  const deleted = await ifItemExists(async () => {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { pk, sk },
        ConditionExpression: ITEM_EXISTS,
      }),
    );
    return true;
  });
  return deleted ?? false;
}

/** Runs a write guarded by ITEM_EXISTS, mapping a failed guard to undefined. */
async function ifItemExists<T>(write: () => Promise<T>): Promise<T | undefined> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
}

export async function queryByPk(
  pk: string,
  skPrefix?: string,
): Promise<TableItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: skPrefix
        ? "pk = :pk AND begins_with(sk, :skPrefix)"
        : "pk = :pk",
      ExpressionAttributeValues: skPrefix
        ? { ":pk": pk, ":skPrefix": skPrefix }
        : { ":pk": pk },
    }),
  );
  return (result.Items ?? []) as TableItem[];
}

export async function queryByGsi1(
  sharedWorkspaceId: string,
): Promise<TableItem[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_INDEX_NAME,
      KeyConditionExpression: "sharedWorkspaceId = :sharedWorkspaceId",
      ExpressionAttributeValues: { ":sharedWorkspaceId": sharedWorkspaceId },
    }),
  );
  return (result.Items ?? []) as TableItem[];
}
