import { Construct } from "constructs";
import { RemovalPolicy, Duration } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";

export interface AuthConstructProps {
  envName: string;
}

/**
 * Own, standalone Cognito user pool — no shared infra with other projects.
 * Real multi-tenant pool from day one (see ARCHITECTURE.md Product context),
 * not a single-user placeholder.
 */
export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `life-dashboard-users-${props.envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // No client secret — the Expo app is a public client (mobile), can't
    // safely hold a secret.
    this.userPoolClient = this.userPool.addClient("MobileClient", {
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      generateSecret: false,
    });
  }
}
