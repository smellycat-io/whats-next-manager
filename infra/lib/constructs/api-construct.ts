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

    this.api = new apigateway.LambdaRestApi(this, "Api", {
      handler,
      proxy: true,
      deployOptions: { stageName: props.envName },
    });
  }
}
