import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from "path";

// The OAuth scope Cognito puts on access tokens issued through its user
// APIs (SRP sign-in), as opposed to hosted-UI custom scopes.
const COGNITO_USER_SCOPE = "aws.cognito.signin.user.admin";

export interface ApiConstructProps {
  envName: string;
  table: dynamodb.Table;
  userPool: cognito.UserPool;
  tokenEncryptionKey: kms.Key;
  exportsBucket: s3.Bucket;
}

/**
 * One Lambda running the Express app (via serverless-http), behind one
 * REST API. Matches ARCHITECTURE.md: single Lambda, not one-function-per-
 * route — keeps this small backend simple to reason about and cheap to run.
 */
export class ApiConstruct extends Construct {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    // backend/ is a sibling npm project, not a subdirectory of infra/ — its
    // own package-lock.json must be passed explicitly. Left to auto-discovery,
    // NodejsFunction resolves the lock file (and project root) from wherever
    // `cdk` is invoked rather than from `entry`, which would find infra/'s
    // lock file instead and reject backend/'s entry as outside that root.
    const backendRoot = path.join(__dirname, "../../../backend");

    const handler = new lambda.NodejsFunction(this, "ApiHandler", {
      entry: path.join(backendRoot, "src/lambda.ts"),
      depsLockFilePath: path.join(backendRoot, "package-lock.json"),
      projectRoot: backendRoot,
      handler: "handler",
      // NodejsFunction still defaults to the long-deprecated Node 16 runtime
      // when this isn't set explicitly (true as of aws-cdk-lib 2.269.0) —
      // pin a current, actively-supported LTS instead.
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      memorySize: 256,
      environment: {
        ENV_NAME: props.envName,
        TABLE_NAME: props.table.tableName,
        USER_POOL_ID: props.userPool.userPoolId,
        TOKEN_KEY_ID: props.tokenEncryptionKey.keyId,
        EXPORTS_BUCKET_NAME: props.exportsBucket.bucketName,
        // Set via a deploy-time secret, never committed:
        // ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
      },
    });

    // Least-privilege grants — one call per resource, not a wildcard policy.
    props.table.grantReadWriteData(handler);
    props.tokenEncryptionKey.grantEncryptDecrypt(handler);
    props.exportsBucket.grantReadWrite(handler);

    const integration = new apigateway.LambdaIntegration(handler);

    // Every method defaults to requiring a valid Cognito access token.
    // API Gateway's Cognito authorizer validates ID tokens unless the method
    // declares OAuth scopes, and then it validates access tokens instead.
    // Access tokens from SRP sign-in carry this scope, so requiring it
    // makes the API accept access tokens, the intended token for API calls.
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      { cognitoUserPools: [props.userPool] },
    );
    const requireCognitoAccessToken: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: [COGNITO_USER_SCOPE],
    };
    const noAuth: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.NONE,
    };

    // A plain RestApi rather than LambdaRestApi: LambdaRestApi with
    // proxy: true refuses addResource on the root, and GET /health needs its
    // own unauthenticated resource. The root ANY + {proxy+} ANY pair below
    // has the same shape (and construct ids) LambdaRestApi creates.
    this.api = new apigateway.RestApi(this, "Api", {
      deployOptions: { stageName: props.envName },
      defaultIntegration: integration,
      defaultMethodOptions: requireCognitoAccessToken,
    });

    // Preflight requests never carry tokens, so OPTIONS stays open and goes
    // to the Lambda, where CORS can be handled if it's added later. API
    // Gateway matches an explicit method before ANY.
    const allowUnauthenticatedPreflight = (resource: apigateway.IResource) =>
      resource.addMethod("OPTIONS", integration, noAuth);

    this.api.root.addMethod("ANY");
    allowUnauthenticatedPreflight(this.api.root);
    allowUnauthenticatedPreflight(this.api.root.addProxy({ anyMethod: true }));

    // Only the exact GET /health liveness check is public. API Gateway
    // doesn't fall back to the root {proxy+} once a request has matched the
    // /health resource, so /health needs its own authenticated {proxy+}
    // so anything below /health still requires a token.
    const health = this.api.root.addResource("health");
    health.addMethod("GET", integration, noAuth);
    allowUnauthenticatedPreflight(health.addProxy({ anyMethod: true }));
  }
}
