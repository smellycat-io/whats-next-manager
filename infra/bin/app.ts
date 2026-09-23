#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LifeDashboardStack } from "../lib/life-dashboard-stack";

const app = new cdk.App();

const envName = (app.node.tryGetContext("env") as string) ?? "stage";

new LifeDashboardStack(app, `LifeDashboardStack-${envName}`, {
  envName,
  // Fill in once you know your account/region, or rely on the CLI's
  // default profile — left unset here so this scaffold isn't tied to a
  // specific account.
  // env: { account: "123456789012", region: "us-east-1" },
});
