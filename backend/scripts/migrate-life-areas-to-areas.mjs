// One-time migration from Life Areas to Areas (see DATA-MODEL.md):
//   - LIFE_AREA#<id> items become AREA#<id> items with kind "life"
//   - lifeAreaIds on any item becomes areaIds
//
// Dry run by default: prints every change without writing. Pass --apply to
// write. Safe to rerun: migrated items no longer match.
//
//   node scripts/migrate-life-areas-to-areas.mjs --table life-dashboard-stage
//   node scripts/migrate-life-areas-to-areas.mjs --table life-dashboard-stage --apply
//
// Delete this script once it has run on prod.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  paginateScan,
} from "@aws-sdk/lib-dynamodb";

const OLD_SK_PREFIX = "LIFE_AREA#";
const NEW_SK_PREFIX = "AREA#";

const args = process.argv.slice(2);
const tableName = args[args.indexOf("--table") + 1];
const apply = args.includes("--apply");
if (!args.includes("--table") || !tableName) {
  console.error("Usage: node scripts/migrate-life-areas-to-areas.mjs --table <name> [--apply]");
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

async function scanAll() {
  const items = [];
  for await (const page of paginateScan({ client }, { TableName: tableName })) {
    items.push(...(page.Items ?? []));
  }
  return items;
}

async function migrateLifeArea(item) {
  const id = item.sk.slice(OLD_SK_PREFIX.length);
  const { lifeAreaIds: _unused, ...rest } = item;
  await client.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...rest, sk: `${NEW_SK_PREFIX}${id}`, type: "AREA", kind: item.kind ?? "life" },
      ConditionExpression: "attribute_not_exists(pk)",
    }),
  );
  await client.send(new DeleteCommand({ TableName: tableName, Key: { pk: item.pk, sk: item.sk } }));
}

async function renameAreaIdsField(item) {
  await client.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: item.pk, sk: item.sk },
      UpdateExpression: "SET areaIds = :ids REMOVE lifeAreaIds",
      ExpressionAttributeValues: { ":ids": item.lifeAreaIds },
    }),
  );
}

const items = await scanAll();
const lifeAreas = items.filter((item) => item.sk.startsWith(OLD_SK_PREFIX));
const taggedItems = items.filter(
  (item) => !item.sk.startsWith(OLD_SK_PREFIX) && item.lifeAreaIds !== undefined,
);

console.log(`${tableName}: ${items.length} items scanned`);
console.log(`\nLife Areas → Areas (${lifeAreas.length}):`);
for (const item of lifeAreas) console.log(`  ${item.pk}  ${item.sk}  "${item.name}"`);
console.log(`\nlifeAreaIds → areaIds (${taggedItems.length}):`);
for (const item of taggedItems) console.log(`  ${item.pk}  ${item.sk}  "${item.name}"`);

if (!apply) {
  console.log("\nDry run: nothing written. Rerun with --apply to migrate.");
  process.exit(0);
}

for (const item of lifeAreas) await migrateLifeArea(item);
for (const item of taggedItems) await renameAreaIdsField(item);
console.log(`\nMigrated ${lifeAreas.length} Areas and ${taggedItems.length} tagged items.`);
