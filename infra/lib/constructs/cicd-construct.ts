import { Construct } from "constructs";
import { Stack, Aws } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";

const GITHUB_OIDC_URL = "https://token.actions.githubusercontent.com";

export interface CiCdConstructProps {
  envName: string;
  /** e.g. "smellycat-io" */
  githubOrg: string;
  /** e.g. "whats-next-manager" */
  githubRepo: string;
  /** Branch this env's deploy role trusts — "stage" or "main". */
  trustedBranch: string;
  /**
   * ARN of a GitHub OIDC provider already registered in this account, found
   * by a pre-synth lookup in bin/app.ts. IAM only allows one OIDC provider
   * per URL per account, and both the stage and prod stacks live in the
   * same account — whichever stack deploys second must reuse the first
   * one's provider instead of trying to create a duplicate. Leave unset to
   * create a new provider (first deploy in the account).
   */
  existingGithubOidcProviderArn?: string;
  /** CDK bootstrap qualifier — matches what `cdk bootstrap` used. */
  bootstrapQualifier?: string;
}

/**
 * The trust relationship GitHub Actions needs to deploy this stack without
 * long-lived AWS access keys (see ARCHITECTURE.md's CI/CD section): a
 * GitHub OIDC identity provider, plus one IAM role per env, each scoped to
 * this specific repo and to the one branch that env deploys from.
 *
 * Deliberately NOT deployed by GitHub Actions itself — this is the trust
 * relationship a pipeline would need in order to run, so it has to exist
 * before any pipeline can. See the "manual step" note in bin/app.ts.
 */
export class CiCdConstruct extends Construct {
  public readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiCdConstructProps) {
    super(scope, id);

    const qualifier = props.bootstrapQualifier ?? "hnb659fds";
    const account = Stack.of(this).account;
    const region = Stack.of(this).region;

    const oidcProvider = props.existingGithubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "GitHubOidcProvider",
          props.existingGithubOidcProviderArn,
        )
      : new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
          url: GITHUB_OIDC_URL,
          clientIds: ["sts.amazonaws.com"],
        });

    // Restricts the trust to this exact repo AND this exact branch — a
    // workflow run from a fork or a different branch can't assume this
    // role, even though the OIDC provider itself is account-wide.
    const principal = new iam.OpenIdConnectPrincipal(oidcProvider).withConditions({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      },
      StringLike: {
        "token.actions.githubusercontent.com:sub": `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/${props.trustedBranch}`,
      },
    });

    this.deployRole = new iam.Role(this, "GitHubActionsDeployRole", {
      roleName: `life-dashboard-github-actions-${props.envName}`,
      description: `Assumed by GitHub Actions via OIDC to deploy LifeDashboardStack-${props.envName} from the ${props.trustedBranch} branch.`,
      assumedBy: principal,
    });

    // This role doesn't need direct DynamoDB/Lambda/Cognito/etc. permissions
    // — `cdk deploy` works by having this role assume the CDK bootstrap
    // roles below, and the bootstrap deploy/cfn-exec roles (already fully
    // permissioned by `cdk bootstrap`) do the actual resource management on
    // CloudFormation's behalf. This role only needs to drive that process:
    // talk to CloudFormation for this stack, assume the bootstrap roles,
    // and read the bootstrap version parameter the CDK CLI checks on every
    // deploy.
    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "DeployThisStack",
        actions: ["cloudformation:*"],
        resources: [
          `arn:aws:cloudformation:${region}:${account}:stack/LifeDashboardStack-${props.envName}/*`,
        ],
      }),
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AssumeCdkBootstrapRoles",
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${account}:role/cdk-${qualifier}-deploy-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${qualifier}-file-publishing-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${qualifier}-image-publishing-role-${account}-${region}`,
          `arn:aws:iam::${account}:role/cdk-${qualifier}-lookup-role-${account}-${region}`,
        ],
      }),
    );

    this.deployRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadCdkBootstrapVersion",
        actions: ["ssm:GetParameter"],
        resources: [
          `arn:aws:ssm:${region}:${account}:parameter/cdk-bootstrap/${qualifier}/version`,
        ],
      }),
    );
  }
}
