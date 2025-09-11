// lib/queue.ts
import { Queue } from "bullmq";

const queue = new Queue(process.env.QUEUE_NAME!, {
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT!, 10),
    password: process.env.REDIS_PASSWORD,
  },
  defaultJobOptions: {
    // Retry settings
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000, // 5 seconds initial delay
    },

    // Job cleanup
    removeOnComplete: 10,
    removeOnFail: 5,
  },
});

export default queue;
