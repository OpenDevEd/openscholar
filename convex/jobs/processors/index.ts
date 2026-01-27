/**
 * Universal Job System - Processor Registry
 *
 * Central registry for job processors. Each processor handles
 * a specific job type's work item processing logic.
 */
import type { ActionCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ProcessorResult, JobItemPayload } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Processor function signature.
 * Takes job context and item payload, returns processing result.
 */
export type ProcessorFn = (
  ctx: ActionCtx,
  job: {
    _id: Id<"jobs">;
    type: string;
    analysisId: Id<"analyses">;
    userId?: Id<"users">;
    metadata?: Record<string, unknown>;
  },
  item: {
    _id: Id<"jobItems">;
    index: number;
    payload: JobItemPayload;
    attempts: number;
  }
) => Promise<ProcessorResult>;

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const processors = new Map<string, ProcessorFn>();

/**
 * Register a processor for a job type.
 */
export function registerProcessor(type: string, fn: ProcessorFn): void {
  if (processors.has(type)) {
    console.warn(`[Jobs] Overwriting processor for type: ${type}`);
  }
  processors.set(type, fn);
  console.log(`[Jobs] Registered processor: ${type}`);
}

/**
 * Get the processor for a job type.
 * Throws if no processor is registered.
 */
export function getProcessor(type: string): ProcessorFn {
  const fn = processors.get(type);
  if (!fn) {
    throw new Error(`No processor registered for job type: ${type}`);
  }
  return fn;
}

/**
 * Check if a processor is registered for a type.
 */
export function hasProcessor(type: string): boolean {
  return processors.has(type);
}

/**
 * Get all registered processor types.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(processors.keys());
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-LOAD PROCESSORS
// Import processor files to trigger registration
// ═══════════════════════════════════════════════════════════════════════════

// These imports will run the registerProcessor calls in each file
// Note: The actual processor implementations are in separate files
// and will be imported when the actions module loads
