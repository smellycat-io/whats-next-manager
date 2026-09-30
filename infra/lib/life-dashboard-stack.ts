import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DatabaseConstruct } from "./constructs/database-construct";
import { AuthConstruct } from "./constructs/auth-construct";
import { StorageConstruct } from "./constructs/storage-construct";
import { ApiConstruct } from "./constructs/api-construct";
import { CiCdConstruct } from "./constructs/cicd-construct";

const GITHUB_ORG = "smellycat-io";
const GITHUB_REPO = "whats-next-manager";

// This stack's own deploy branch — matches Deploy & repo flow in
// ARCHITECTURE.md (feature branch → stage → main).
const TRUSTED_BRANCH_BY_ENV: Record<string, string> = {
  stage: "stage",
  prod: "main",
};

export interface LifeDashboardStackProps extends StackProps {
  envName: string;
  /** See cicd-construct.ts — passed through from bin/app.ts's pre-synth lookup. */
  existingGithubOidcProviderArn?: string;
}

/**
 * Composes the five constructs into one deployable stack. Each construct
 * owns one concern (database, auth, storage, API, CI/CD trust) per
 * CLAUDE.md's single-responsibility rule — this file just wires them
 * together.
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

    const cicd = new CiCdConstruct(this, "CiCd", {
      envName: props.envName,
      githubOrg: GITHUB_ORG,
      githubRepo: GITHUB_REPO,
      trustedBranch: TRUSTED_BRANCH_BY_ENV[props.envName] ?? props.envName,
      existingGithubOidcProviderArn: props.existingGithubOidcProviderArn,
    });

    // Outputs the Expo app needs to configure itself against this environment.
    new CfnOutput(this, "ApiUrl", { value: api.api.url });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: auth.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
    new CfnOutput(this, "GitHubActionsRoleArn", {
      value: cicd.deployRole.roleArn,
    });
  }
}
