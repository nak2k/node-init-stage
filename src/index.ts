import { Subsegment, Segment } from 'aws-xray-sdk-core';

/*
 * The symbol to store the context object into the global object.
 */
const CONTEXT_SYMBOL = Symbol.for('953cff82-204f-11ea-9133-af140ff69b51');

/*
 * The singleton object that has data for init stage functions to work.
 */
interface Context {
  /*
   * The original setImmediate().
   */
  originalSetImmediate: (callback: (...args: any[]) => void, ...args: any[]) => any;

  /*
   * A promise to wait async tasks.
   */
  lastPromise: Promise<any>;

  /*
   * A subsegment to record async tasks in the init stage.
   */
  initStageSubsegment?: Subsegment;

  /*
   * A boolean value whether initStage() or initStageWithTracing() are running.
   */
  inflightInitStage?: boolean;
}

/*
 * Add a result of an async task into the promise chain.
 */
function addToPromiseChain(context: Context, result: any) {
  context.lastPromise = context.lastPromise.finally(() => result);
}

/*
 * Get the context object.
 */
function getContext(): Context {
  const context = (global as any)[CONTEXT_SYMBOL];

  if (context) {
    return context;
  }

  /*
   * Replace setImmediate() first.
   */
  const originalSetImmediate = global.setImmediate;

  global.setImmediate = firstSetImmediate;

  /*
   * Create the context onbject and store into the global object.
   */
  return (global as any)[CONTEXT_SYMBOL] = {
    originalSetImmediate,
    lastPromise: Promise.resolve(),
  };
}

/*
 * Wait all async tasks in the init stage when the lambda runtime calls setImmediate().
 */
function firstSetImmediate(callback: (...args: any[]) => void, ...args: any[]) {
  const context = getContext();
  const { originalSetImmediate } = context;

  /*
   * If this function is not called from the lambda runtime,
   * forward to original setImmediate().
   */
  if (context.inflightInitStage) {
    return originalSetImmediate(callback, ...args);
  }

  /*
   * Restore setImmediate() because the first replacing done the purpose.
   */
  global.setImmediate = originalSetImmediate;

  return originalSetImmediate(() => context.lastPromise.finally(() => {
    /*
     * If initStageWithTracing() is used, record the end time of async tasks
     * and replace setImmediate() again.
     *
     * At this time the environment variable _X_AMZN_TRACE_ID is undefined,
     * so the subsegment for the init stage is not could send to the X-Ray daemon yet.
     */
    const { initStageSubsegment } = getContext();

    if (initStageSubsegment) {
      (initStageSubsegment as any).end_time = Date.now() / 1000;
      global.setImmediate = secondSetImmediate;
    }

    /*
     * Execute the rest of the lambda runtime.
     */
    callback(...args);
  }));
};

/*
 * Send tracing data for async tasks in the init stage to X-Ray
 * after the environment variables for X-Ray is set.
 * 
 * This function is called in either of the following cases:
 * 
 * 1. The case where setImmediate() is called from the lambda handler.
 * 2. Otherwise, just before the next event acquisition.
 */
function secondSetImmediate(callback: (...args: any[]) => void, ...args: any[]) {
  const { originalSetImmediate } = getContext();

  global.setImmediate = originalSetImmediate;

  if (process.env._X_AMZN_TRACE_ID) {
    const segment: Segment = require('aws-xray-sdk-core').getSegment();
    const { initStageSubsegment } = getContext();

    if (segment && initStageSubsegment) {
      segment.addSubsegment(initStageSubsegment);
      initStageSubsegment.close();
    }
  }

  return originalSetImmediate(callback, ...args);
};

function initInitStageSubsegment() {
  const { Subsegment } = require('aws-xray-sdk-core');

  return new Subsegment('init-stage');
}

/**
 * This function calls a specified function in the init stage. If the function is async function,
 * the Lambda handler is not called until the async task is completed.
 * In case this function is called multiple times, the Lambda handler is not called until all async tasks are completed.
 *
 * All async tasks is executed in parallel, and they must be completed in 10 seconds.
 *
 * @param fn A function or an async function that is called in the init stage.
 */
export function initStage<T>(fn: () => T): T {
  const context = getContext();
  context.inflightInitStage = true;

  const result = fn();

  addToPromiseChain(context, result);

  context.inflightInitStage = false;
  return result;
}

/**
 * This function is equivalent to the `initStage` except tracing by AWS X-Ray.
 *
 * If this function is used, you have to install [aws-xray-sdk-core](https://www.npmjs.com/package/aws-xray-sdk-core).
 *
 * @param name A name of a subsegment that records informations of an async task with X-Ray.
 * @param fn An async function that is called in the init stage.
 */
export function initStageWithTracing<T>(name: string, fn: (subsegment: Subsegment) => Promise<T>): Promise<T> {
  const context = getContext();
  context.inflightInitStage = true;

  const {
    initStageSubsegment = context.initStageSubsegment = initInitStageSubsegment(),
  } = context;

  const subsegment = initStageSubsegment.addNewSubsegment(name);

  const promise = fn(subsegment);

  addToPromiseChain(
    context,
    promise.then(
      result => {
        subsegment.close();
        return result;
      },
      err => subsegment.close(err)
    )
  );

  context.inflightInitStage = false;
  return promise;
}
