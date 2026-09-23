import { Construct } from "constructs";
import { RemovalPolicy, Duration } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";

export interface StorageConstructProps {
  envName: string;
}

/**
 * S3 for exports (PDF/CSV snapshots — not core data) and a single shared
 * KMS key for encrypting per-user OAuth refresh tokens (Google now, Plaid
 * later). One key for all users, not one per user — see ARCHITECTURE.md
 * "Google Calendar token handling" for the cost reasoning.
 */
export class StorageConstruct extends Construct {
  public readonly exportsBucket: s3.Bucket;
  public readonly tokenEncryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);

    this.exportsBucket = new s3.Bucket(this, "ExportsBucket", {
      bucketName: `life-dashboard-exports-${props.envName}-${scope.node.addr.slice(0, 8)}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy:
        props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: props.envName !== "prod",
      lifecycleRules: [
        // Exports are re-generatable — no need to keep them forever.
        { expiration: Duration.days(90) },
      ],
    });

    this.tokenEncryptionKey = new kms.Key(this, "TokenEncryptionKey", {
      alias: `life-dashboard-tokens-${props.envName}`,
      description:
        "Shared key for encrypting per-user OAuth refresh tokens (Google, Plaid)",
      enableKeyRotation: true,
      removalPolicy:
        props.envName === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
  }
}
