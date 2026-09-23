import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
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

const ddbClient = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export type TableItem = Record<string, unknown> & { pk: string; sk: string };

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
  const setClauses = keys.map((key, index) => {
    const nameToken = `#f${index}`;
    const valueToken = `:v${index}`;
    expressionAttributeNames[nameToken] = key;
    expressionAttributeValues[valueToken] = updates[key];
    return `${nameToken} = ${valueToken}`;
  });

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: `SET ${setClauses.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    }),
  );
  return result.Attributes as TableItem | undefined;
}

export async function deleteItem(pk: string, sk: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk, sk },
    }),
  );
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
