import { initStage, initStageWithTracing } from 'init-stage';
import { captureAWS } from 'aws-xray-sdk-core';

const AWS = captureAWS(require('aws-sdk'));

const task1 = initStageWithTracing('task1', async (_subsegment) => {
  console.log('Begin task1');

  const s3 = new AWS.S3();

  const { Buckets = [] } = await s3.listBuckets().promise();

  console.log('End task1');

  return Buckets;
});

const task2 = initStageWithTracing('task2', (_subsegment) => {
  console.log('Begin task2');

  setImmediate(() => {
    console.log('setImmediate in task2');
  });

  return new Promise<number>(resolve => {
    setTimeout(() => {
      console.log('End task2');

      resolve(222);
    }, 4000);
  });
});

const task3 = initStage(() => {
  console.log('Begin task3');

  return new Promise<number>(resolve => {
    setTimeout(() => {
      console.log('End task3');

      resolve(333);
    }, 6000);
  });
});


export async function handler(_event: any, _context: any) {
  const buckets = await task1;
  const bucketNames = buckets.map(bucket => bucket.Name);

  console.log(`Buckets: ${bucketNames.join(', ')}`);

  const result = await task2 + await task3;

  console.log(`Result ${result}`);

  return result;
}
