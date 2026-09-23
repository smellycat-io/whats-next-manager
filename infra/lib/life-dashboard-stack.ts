import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DatabaseConstruct } from "./constructs/database-construct";
import { AuthConstruct } from "./constructs/auth-construct";
import { StorageConstruct } from "./constructs/storage-construct";
import { ApiConstruct } from "./constructs/api-construct";

export interface LifeDashboardStackProps extends StackProps {
  envName: string;
}

/**
 * Composes the four constructs into one deployable stack. Each construct
 * owns one concern (database, auth, storage, API) per CLAUDE.md's
 * single-responsibility rule — this file just wires them together.
 */
export class LifeDashboardStack extends Stack {
  constructor(scope: Construct, id: string, props: LifeDashboardStackProps) {
    super(scope, id, props);

    const database = new DatabaseConstruct(this, "Database", {
      envName: props.envName,
    });

    const auth = new AuthConstruct(this, "Auth", {
      envName: props.envName,
    });

    const storage = new StorageConstruct(this, "Storage", {
      envName: props.envName,
    });

    const api = new ApiConstruct(this, "Api", {
      envName: props.envName,
      table: database.table,
      userPool: auth.userPool,
      tokenEncryptionKey: storage.tokenEncryptionKey,
      exportsBucket: storage.exportsBucket,
    });

    // Outputs the Expo app needs to configure itself against this environment.
    new CfnOutput(this, "ApiUrl", { value: api.api.url });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: auth.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
  }
}
