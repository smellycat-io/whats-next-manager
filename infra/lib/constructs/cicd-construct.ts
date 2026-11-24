import { Construct } from "constructs";
import { Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";

const GITHUB_OIDC_HOST = "token.actions.githubusercontent.com";
const GITHUB_OIDC_URL = `https://${GITHUB_OIDC_HOST}`;

export interface CiCdConstructProps {
  envName: string;
  /** e.g. "smellycat-io" */
  githubOrg: string;
  /** Numeric GitHub account id of githubOrg, e.g. "199698335". */
  githubOrgId: string;
  /** e.g. "whats-next-manager" */
  githubRepo: string;
  /** Numeric GitHub repository id of githubRepo, e.g. "1365035550". */
  githubRepoId: string;
  /** Branch this env's deploy role trusts — "stage" or "main". */
  trustedBranch: string;
  /**
   * Whether this stack creates and owns the account's GitHub OIDC provider.
   * IAM allows only one OIDC provider per URL per account, and the stage
   * and prod stacks share an account, so exactly one stack (stage) owns it
   * and the other imports it by its fixed ARN.
   *
   * This must be a fixed per-env decision, not a "does it exist yet?"
   * lookup at synth time: once the provider exists, a lookup makes the
   * owning stack switch to importing it, CloudFormation then deletes the
   * stack's provider resource, and that resource's delete handler removes
   * the real provider from IAM, breaking every deploy role in the account.
   * In a fresh account the owning stack must be deployed first.
   */
  ownsGithubOidcProvider: boolean;
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

    const oidcProvider = props.ownsGithubOidcProvider
      ? new iam.OpenIdConnectProvider(this, "GitHubOidcProvider", {
          url: GITHUB_OIDC_URL,
          clientIds: ["sts.amazonaws.com"],
        })
      : iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "GitHubOidcProvider",
          `arn:${Stack.of(this).partition}:iam::${account}:oidc-provider/${GITHUB_OIDC_HOST}`,
        );

    // Restricts the trust to this exact repo AND this exact branch — a
    // workflow run from a fork or a different branch can't assume this
    // role, even though the OIDC provider itself is account-wide.
    //
    // The repo has GitHub's immutable OIDC subject enabled
    // (use_immutable_subject, see GET /repos/{owner}/{repo}/actions/oidc/
    // customization/sub), so the `sub` claim embeds the numeric owner and
    // repo ids: repo:<org>@<orgId>/<repo>@<repoId>:ref:refs/heads/<branch>.
    // That guards against a deleted-and-recreated (or renamed-into-place)
    // repo with the same name inheriting this trust, since a new repo gets
    // a new id. A plain repo:<org>/<repo>:... condition never matches and
    // every deploy fails with "Not authorized to perform
    // sts:AssumeRoleWithWebIdentity". Exact match (StringEquals), no
    // wildcards.
    const principal = new iam.OpenIdConnectPrincipal(oidcProvider).withConditions({
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": `repo:${props.githubOrg}@${props.githubOrgId}/${props.githubRepo}@${props.githubRepoId}:ref:refs/heads/${props.trustedBranch}`,
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
