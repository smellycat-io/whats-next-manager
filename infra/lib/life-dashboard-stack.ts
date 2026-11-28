import { Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DatabaseConstruct } from "./constructs/database-construct";
import { AuthConstruct } from "./constructs/auth-construct";
import { StorageConstruct } from "./constructs/storage-construct";
import { ApiConstruct } from "./constructs/api-construct";
import { CiCdConstruct } from "./constructs/cicd-construct";

const GITHUB_ORG = "smellycat-io";
const GITHUB_REPO = "whats-next-manager";
// Numeric ids GitHub embeds in the OIDC `sub` claim (see cicd-construct.ts).
// From `gh api users/smellycat-io --jq .id` and
// `gh api repos/smellycat-io/whats-next-manager --jq .id`.
const GITHUB_ORG_ID = "199698335";
const GITHUB_REPO_ID = "1365035550";

// The stage stack created the account's GitHub OIDC provider and keeps
// owning it; prod imports it (see ownsGithubOidcProvider in
// cicd-construct.ts for why this can't be decided by a lookup).
const GITHUB_OIDC_PROVIDER_OWNER_ENV = "stage";

// This stack's own deploy branch — matches Deploy & repo flow in
// ARCHITECTURE.md (feature branch → stage → main).
const TRUSTED_BRANCH_BY_ENV: Record<string, string> = {
  stage: "stage",
  prod: "main",
};

export interface LifeDashboardStackProps extends StackProps {
  envName: string;
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
      githubOrgId: GITHUB_ORG_ID,
      githubRepo: GITHUB_REPO,
      githubRepoId: GITHUB_REPO_ID,
      trustedBranch: TRUSTED_BRANCH_BY_ENV[props.envName] ?? props.envName,
      ownsGithubOidcProvider: props.envName === GITHUB_OIDC_PROVIDER_OWNER_ENV,
    });

    // Outputs the clients need to configure themselves against this
    // environment. The agent client's secret is deliberately not an output;
    // read it with `aws cognito-idp describe-user-pool-client`.
    new CfnOutput(this, "ApiUrl", { value: api.api.url });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "MobileClientId", {
      value: auth.mobileClient.userPoolClientId,
    });
    new CfnOutput(this, "AgentClientId", {
      value: auth.agentClient.userPoolClientId,
    });
    new CfnOutput(this, "TableName", { value: database.table.tableName });
    new CfnOutput(this, "GitHubActionsRoleArn", {
      value: cicd.deployRole.roleArn,
    });
  }
}
