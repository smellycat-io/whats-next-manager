import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

export interface DatabaseConstructProps {
  /** "stage" or "prod" — controls removal policy so stage can be torn down freely. */
  envName: string;
}

/**
 * Single-table DynamoDB design per DATA-MODEL.md.
 * PK = USER#<id>, SK = <TYPE>#<id> (or a fixed value like "BUDGET_CARD#<id>").
 * One table holds every entity type; `type` differentiates records.
 */
export class DatabaseConstruct extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, "Table", {
      tableName: `life-dashboard-${props.envName}`,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        props.envName === "prod"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      pointInTimeRecovery: props.envName === "prod",
    });

    // Sparse GSI for shared Workspaces (see WORKSPACES.md / DATA-MODEL.md):
    // only items with sharedWorkspaceId set (a shared Life Area and
    // everything tagged under it) appear here, regardless of which user's
    // partition owns them. Sort key reuses the base table's `sk` attribute,
    // whose values already follow the `TYPE#id` shape the docs describe.
    this.table.addGlobalSecondaryIndex({
      indexName: "GSI1-sharedWorkspace",
      partitionKey: {
        name: "sharedWorkspaceId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }
}
