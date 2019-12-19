#!/usr/bin/env node
import 'source-map-support/register';
import { App, Stack, Construct } from '@aws-cdk/core';
import { Function, Runtime, Code, Tracing, LayerVersion } from '@aws-cdk/aws-lambda';
import { FollowMode } from '@aws-cdk/assets';
import { PolicyStatement } from '@aws-cdk/aws-iam';

class InitStageExampleStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const layer = new LayerVersion(this, 'LayerVersion', {
      code: Code.fromAsset('layer', {
        follow: FollowMode.ALWAYS,
      })
    });

    const handler = new Function(this, 'Function', {
      runtime: Runtime.NODEJS_12_X,
      code: Code.fromAsset('lambda', {
        exclude: [
          'package*.json',
          'node_modules',
          'tsconfig.json',
          '*.ts',
          '*.d.js',
        ]
      }),
      handler: 'index.handler',
      layers: [
        layer,
      ],
      tracing: Tracing.ACTIVE,
    });

    handler.grantPrincipal.addToPolicy(new PolicyStatement({
      actions: ['s3:ListAllMyBuckets'],
      resources: ['*'],
    }));
  }
}

const app = new App();

new InitStageExampleStack(app, 'InitStageExampleStack');
