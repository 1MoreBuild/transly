export function createRequestQueue(maxConcurrent = 5) {
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  const waiting = [];
  let active = 0;

  function drain() {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active++;
      Promise.resolve()
        .then(job.operation)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  }

  return {
    run(operation) {
      return new Promise((resolve, reject) => {
        waiting.push({ operation, resolve, reject });
        drain();
      });
    },
    stats() {
      return { active, waiting: waiting.length, limit };
    }
  };
}
