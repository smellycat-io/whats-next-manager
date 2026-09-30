#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import {
  IAMClient,
  ListOpenIDConnectProvidersCommand,
  GetOpenIDConnectProviderCommand,
} from "@aws-sdk/client-iam";
import { LifeDashboardStack } from "../lib/life-dashboard-stack";

const GITHUB_OIDC_HOSTNAME = "token.actions.githubusercontent.com";

/**
 * IAM allows only one OIDC provider per URL per account, and the stage and
 * prod stacks both deploy into the same account (see cicd-construct.ts) —
 * so before synthesizing either stack, check whether a GitHub OIDC provider
 * already exists and reuse it instead of letting the second stack try (and
 * fail) to create a duplicate.
 */
async function findExistingGithubOidcProviderArn(): Promise<
  string | undefined
> {
  const iamClient = new IAMClient({});
  const { OpenIDConnectProviderList } = await iamClient.send(
    new ListOpenIDConnectProvidersCommand({}),
  );

  for (const provider of OpenIDConnectProviderList ?? []) {
    if (!provider.Arn) continue;
    const details = await iamClient.send(
      new GetOpenIDConnectProviderCommand({
        OpenIDConnectProviderArn: provider.Arn,
      }),
    );
    if (details.Url?.includes(GITHUB_OIDC_HOSTNAME)) {
      return provider.Arn;
    }
  }
  return undefined;
}

async function main() {
  const app = new cdk.App();

  const envName = (app.node.tryGetContext("env") as string) ?? "stage";
  const existingGithubOidcProviderArn = await findExistingGithubOidcProviderArn();

  new LifeDashboardStack(app, `LifeDashboardStack-${envName}`, {
    envName,
    existingGithubOidcProviderArn,
    // Fill in once you know your account/region, or rely on the CLI's
    // default profile — left unset here so this scaffold isn't tied to a
    // specific account.
    // env: { account: "123456789012", region: "us-east-1" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
