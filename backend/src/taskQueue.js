/**
 * Lightweight concurrent task runner for Vercel serverless.
 * 
 * Uses Promise-based concurrency control instead of worker_threads,
 * since Vercel serverless does NOT support Node.js worker_threads.
 * All tasks here are I/O-bound (API calls), so async concurrency
 * is the optimal pattern.
 */

/**
 * Runs an array of async task functions with bounded concurrency.
 * Returns results in the same order as the input tasks.
 * 
 * @param {Array<() => Promise<any>>} tasks - Array of async functions to execute
 * @param {number} concurrency - Max number of tasks running simultaneously
 * @returns {Promise<Array<{status: 'fulfilled'|'rejected', value?: any, reason?: string}>>}
 */
async function runConcurrent(tasks, concurrency = 3) {
  const results = new Array(tasks.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < tasks.length) {
      const idx = currentIndex++;
      try {
        const value = await tasks[idx]();
        results[idx] = { status: 'fulfilled', value };
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err.message || String(err) };
      }
    }
  }

  // Spawn `concurrency` number of worker loops
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

module.exports = { runConcurrent };
