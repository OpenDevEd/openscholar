/**
 * BullMQ Worker for Parallel Systematic Review Processing
 *
 * This worker handles background processing for systematic review tasks,
 * supporting high-throughput parallel processing of up to 100+ concurrent jobs.
 *
 * Usage Options:
 *
 * Development Mode:
 * - npm run worker        # Run single worker instance
 * - npm run worker:dev    # Run with file watching (development)
 * - npm run dev:full      # Run both Next.js app and worker concurrently
 *
 * Production Mode (with PM2):
 * - npm run worker:pm2        # Start multiple worker instances with PM2
 * - npm run worker:pm2:dev    # Start in development environment
 * - npm run worker:pm2:prod   # Start in production environment
 * - npm run worker:pm2:stop   # Stop all worker instances
 * - npm run worker:pm2:restart # Restart all worker instances
 * - npm run worker:pm2:logs   # View merged worker logs
 * - npm run worker:pm2:monit  # Open PM2 monitoring interface
 * - npm run worker:pm2:delete # Delete all worker processes
 *
 * Environment Variables Required:
 * - QUEUE_NAME: Name of the BullMQ queue
 * - REDIS_HOST: Redis server hostname
 * - REDIS_PORT: Redis server port
 * - REDIS_PASSWORD: Redis server password (optional)
 *
 * Parallel Processing Features:
 * - Concurrent processing: Up to 10 jobs per worker instance
 * - Multi-instance clustering: Scales with CPU cores
 * - High-throughput rate limiting: 50 jobs/second across all instances
 * - Automatic load balancing: Jobs distributed across worker instances
 * - Memory optimization: 256MB per worker instance
 *
 * PM2 Features:
 * - Automatic restarts on crashes
 * - Log management and rotation
 * - Memory monitoring and limits (512MB per instance)
 * - Health checks every 15 seconds
 * - Graceful shutdown handling
 * - Process clustering with load balancing
 *
 * The worker processes jobs with type 'search-execution' and performs:
 * 1. Database queries for review data and search terms
 * 2. Multi-step systematic review process simulation
 * 3. Progress updates with detailed step tracking
 * 4. AI-powered processing (when configured)
 * 5. Result storage and completion handling
 */

import { Worker, Job } from "bullmq";
import dotenv from "dotenv";
dotenv.config();

// Mock search execution function - replace with real API calls
async function processSearchExecution(job: Job): Promise<any> {
  const { reviewId, aiConfig } = job.data;

  console.log(`Starting search execution for review ${reviewId}`);
  console.log(`AI Configuration:`, aiConfig ? { provider: aiConfig.provider, hasApiKey: !!aiConfig.apiKey } : 'No AI config provided');

  // Query database for review data
  const { db } = await import('@/db');
  const { systematicReviews } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  const [review] = await db
    .select()
    .from(systematicReviews)
    .where(eq(systematicReviews.id, reviewId));

  if (!review) {
    throw new Error(`Review ${reviewId} not found`);
  }

  const searchTerms = review.searchTerms;
  const researchQuestion = review.researchQuestion

  console.log(`Found ${Array.isArray(searchTerms) ? searchTerms.length : 0} search terms`);
  console.log(`Research question:`, researchQuestion);

  // Define systematic review process steps
  const reviewSteps = [
    { name: 'Preparing search queries', duration: 20000 },
    { name: 'Searching PubMed', duration: 5000 },
    { name: 'Searching Web of Science', duration: 40000 },
    { name: 'Searching Scopus', duration: 60000 },
    { name: 'Searching Google Scholar', duration: 30000 },
    { name: 'Processing search results', duration: 20000 },
    { name: 'AI-powered screening by title and abstract', duration: 40000, usesAI: true },
    { name: 'AI-powered full-text screening', duration: 30000, usesAI: true },
    { name: 'AI-assisted data extraction', duration: 50000, usesAI: true },
    { name: 'Quality assessment with AI support', duration: 20000, usesAI: true },
    { name: 'Data synthesis and analysis', duration: 30000 },
    { name: 'Finalizing systematic review', duration: 15000 }
  ];

  // Check for existing progress to enable resume capability
  let startFromStep = 0;
  if (review.progress && review.progress > 0) {
    // Calculate which step to resume from based on progress
    const progressPerStep = 100 / reviewSteps.length;
    startFromStep = Math.floor(review.progress / progressPerStep);
    console.log(`📍 Resuming from step ${startFromStep} (${review.progress}% complete)`);
  }

  let totalResults = 0;
  const stepsProgress = reviewSteps.map((step, index) => ({
    name: step.name,
    index,
    startedAt: null as string | null,
    completedAt: null as string | null,
    status: 'pending' as 'pending' | 'active' | 'completed'
  }));

  for (let i = startFromStep; i < reviewSteps.length; i++) {
    const step = reviewSteps[i];

    // Check if job has been cancelled before starting each step
    const [currentReview] = await db
      .select()
      .from(systematicReviews)
      .where(eq(systematicReviews.id, reviewId));

    // Only check for cancellation if this is still the same job
    if (currentReview?.jobCancelled && currentReview?.jobId === job.id) {
      console.log(`🛑 Job ${reviewId} has been cancelled. Stopping execution.`);
      throw new Error('Job cancelled by user');
    }

    const stepStartTime = new Date().toISOString();

    // Mark step as started (only if not already started)
    if (!stepsProgress[i].startedAt) {
      stepsProgress[i].startedAt = stepStartTime;
    }
    stepsProgress[i].status = 'active';

    // Log AI usage for steps that require it
    if (step.usesAI) {
      if (aiConfig) {
        console.log(`${startFromStep > 0 ? '🔄' : '🔧'} Step ${i + 1}: Using ${aiConfig.provider} AI for "${step.name}"${startFromStep > 0 ? ' (resumed)' : ''}`);
      } else {
        console.log(`⚠️ Step ${i + 1}: AI requested but no configuration provided for "${step.name}"`);
      }
    }

    const overallProgress = (i / reviewSteps.length) * 100;

    // Simulate step progress
    const stepSubSteps = 5;
    for (let subStep = 0; subStep < stepSubSteps; subStep++) {
      const stepProgress = (subStep / stepSubSteps) * (100 / reviewSteps.length);
      const currentProgress = Math.round(overallProgress + stepProgress);

      // Generate results during search steps (steps 1-4 are database searches)
      if (i >= 1 && i <= 4) { // PubMed, Web of Science, Scopus, Google Scholar
        const stepResults = Math.floor(Math.random() * 30) + 5;
        totalResults += stepResults;
      }

      const progressWithinStep = Math.round((subStep / stepSubSteps) * 100);

      // Check for cancellation during step processing
      const [midStepReview] = await db
        .select()
        .from(systematicReviews)
        .where(eq(systematicReviews.id, reviewId));

      // Only check for cancellation if this is still the same job
      if (midStepReview?.jobCancelled && midStepReview?.jobId === job.id) {
        console.log(`🛑 Job ${reviewId} cancelled during step ${i + 1}. Stopping execution.`);
        throw new Error('Job cancelled by user');
      }

      await job.updateProgress({
        progress: currentProgress,
        currentStep: i,
        steps: stepsProgress.map(s => ({
          ...s,
          startedAt: s.startedAt || undefined,
          completedAt: s.completedAt || undefined
        })),
        progressWithinStep,
        resultsCount: totalResults,
        estimatedTimeRemaining: Math.round(
          ((reviewSteps.length - i - 1) * step.duration +
           (stepSubSteps - subStep - 1) * (step.duration / stepSubSteps)) / 1000
        ),
        status: `Step ${i + 1}/${reviewSteps.length}: ${step.name}`
      });

      // Simulate step delay
      await new Promise(resolve => setTimeout(resolve, step.duration / stepSubSteps));
    }

    // Mark step as completed
    stepsProgress[i].completedAt = new Date().toISOString();
    stepsProgress[i].status = 'completed';

    // Save intermediate progress to database for recovery
    if (i > startFromStep) { // Only save if we've made progress
      try {
        await db
          .update(systematicReviews)
          .set({
            progress: Math.round(overallProgress),
            searchResultsCount: totalResults,
            updatedAt: new Date(),
          })
          .where(eq(systematicReviews.id, reviewId));
        console.log(`💾 Saved intermediate progress: ${Math.round(overallProgress)}%`);
      } catch (error) {
        console.error('Failed to save intermediate progress:', error);
      }
    }
  }

  // Send final progress update with all steps completed
  console.log(`🎉 All steps completed! Sending final progress update...`);

  // Ensure the final step is properly marked as completed
  const finalStepIndex = reviewSteps.length - 1;
  if (stepsProgress[finalStepIndex]) {
    stepsProgress[finalStepIndex].status = 'completed';
    stepsProgress[finalStepIndex].completedAt = new Date().toISOString();
  }

  await job.updateProgress({
    progress: 100,
    currentStep: finalStepIndex,
    steps: stepsProgress.map(s => ({
      ...s,
      startedAt: s.startedAt || undefined,
      completedAt: s.completedAt || undefined
    })),
    progressWithinStep: 100,
    resultsCount: totalResults,
    estimatedTimeRemaining: 0,
    status: `Step ${reviewSteps.length}/${reviewSteps.length}: ${reviewSteps[finalStepIndex].name} - COMPLETED`
  });

  // Generate mock search results
  const mockResults = Array.from({ length: totalResults }, (_, i) => ({
    id: `result_${i + 1}`,
    title: `Research Paper Title ${i + 1}`,
    authors: ['Author A', 'Author B'],
    journal: 'Journal of Research',
    year: 2023 - Math.floor(Math.random() * 5),
    abstract: `This is a mock abstract for paper ${i + 1} related to the research question.`,
    doi: `10.1000/mock-doi-${i + 1}`,
    url: `https://example.com/paper/${i + 1}`,
    relevanceScore: Math.random() * 100,
  }));

  console.log(`Search execution completed for review ${reviewId}. Found ${totalResults} results.`);

  return {
    searchResults: mockResults,
    resultsCount: totalResults,
    stepsCompleted: stepsProgress,
    searchTermsUsed: searchTerms,
    completedAt: new Date().toISOString(),
  };
}

const worker = new Worker(
  process.env.QUEUE_NAME!,
  async (job) => {
    console.log(`Processing job ${job.id} with data:`, job.data);

    // Handle different job types
    if (job.data.type === 'search-execution' || job.name === 'search-execution') {
      try {
        return await processSearchExecution(job);
      } catch (error) {
        // Check if this is a cancellation error
        if (error instanceof Error && error.message === 'Job cancelled by user') {
          console.log(`Job ${job.id} was cancelled by user - marking as completed`);
          // For cancelled jobs, return a successful result to prevent retries
          return {
            cancelled: true,
            message: 'Job cancelled by user',
            completedAt: new Date().toISOString()
          };
        }

        console.error(`Job ${job.id} failed:`, error);
        throw error; // Re-throw non-cancellation errors to allow retries
      }
    }

    // Default: long running task with progress updates
    for (let i = 0; i <= 100; i += 20) {
      await new Promise((r) => setTimeout(r, 500));
      await job.updateProgress(i);
    }

    return { message: "Task finished!", input: job.data.input };
  },
  {
    connection: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT!, 10),
      password: process.env.REDIS_PASSWORD,
    },
    // Worker settings for parallel systematic review jobs
    concurrency: 10,         // Process up to 10 jobs concurrently
    limiter: {
      max: 50,               // Maximum 50 jobs per duration
      duration: 1000,        // Per second - allow high throughput
    },
    // Additional settings for high-throughput processing
    lockDuration: 30000,     // 30 second job lock duration
    stalledInterval: 30000,  // Check for stalled jobs every 30 seconds
    maxStalledCount: 3,      // Max stalled attempts before marking as failed
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err);
  console.error(`   Attempts made: ${job?.attemptsMade}/${job?.opts?.attempts || 1}`);
});

worker.on("stalled", (jobId) => {
  console.warn(`⚠️ Job ${jobId} stalled - checking if it's a long-running systematic review job`);
  console.warn(`   This is normal for jobs that take >10 minutes. Job will be retried if within limits.`);
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing worker gracefully...');
  await worker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing worker gracefully...');
  await worker.close();
  process.exit(0);
});
