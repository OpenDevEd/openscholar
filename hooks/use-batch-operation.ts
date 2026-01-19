"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";

interface Paper {
  id: string;
  title?: string;
  abstract?: string;
}

interface BatchError {
  paperId: string;
  error: string;
}

interface BatchResult<TResult> {
  results: Record<string, TResult>;
  errors: BatchError[];
}

interface UseBatchOperationConfig<TInput, TResult, TContext> {
  /** Function to execute the batch operation */
  execute: (input: TInput) => Promise<BatchResult<TResult>>;
  /** Whether the operation is configured and ready to run */
  isConfigured: boolean;
  /** Compute a unique key for deduplication. Return null to skip processing. */
  computeBatchKey: (papers: Paper[], context: TContext) => string | null;
  /** Filter papers that actually need processing */
  filterItemsNeedingProcessing: (papers: Paper[], context: TContext) => Paper[];
  /** Build the input for the execute function */
  buildExecuteInput: (papers: Paper[], context: TContext) => TInput;
  /** Handle a single result */
  handleResult: (paperId: string, result: TResult, context: TContext) => void;
  /** Dependencies that should trigger a reset of the fetched keys */
  resetDeps: any[];
  /** Current context value for race condition detection */
  context: TContext;
  /** Whether we can start processing */
  canStart: boolean;
  /** The papers to process */
  papers: Paper[];
}

interface UseBatchOperationReturn<TLoadingState> {
  /** Loading state (varies by operation type) */
  loadingState: TLoadingState;
  /** Errors that occurred during processing */
  errors: BatchError[];
  /** Whether the operation is configured */
  isConfigured: boolean;
}

/**
 * Generic factory hook for batch operations (screening, translation, etc.)
 * 
 * Key safeguards:
 * 1. Uses a stable batchKey for deduplication
 * 2. Tracks fetched keys in a ref to prevent duplicate fetches
 * 3. Clears the ref when reset dependencies change
 * 4. Uses contextRef to prevent race conditions when context changes mid-flight
 * 5. Exposes errors for UI feedback
 */
export function useBatchOperation<TInput, TResult, TContext, TLoadingState>({
  execute,
  isConfigured,
  computeBatchKey,
  filterItemsNeedingProcessing,
  buildExecuteInput,
  handleResult,
  resetDeps,
  context,
  canStart,
  papers,
  createLoadingState,
  clearLoadingState,
}: UseBatchOperationConfig<TInput, TResult, TContext> & {
  /** Create loading state from papers being processed */
  createLoadingState: (papers: Paper[]) => TLoadingState;
  /** Clear/empty loading state */
  clearLoadingState: () => TLoadingState;
}): UseBatchOperationReturn<TLoadingState> {
  const [loadingState, setLoadingState] = useState<TLoadingState>(() => clearLoadingState());
  const [errors, setErrors] = useState<BatchError[]>([]);
  const fetchedKeysRef = useRef<Set<string>>(new Set());
  const isFetchingRef = useRef(false);
  const contextAtFetchRef = useRef<TContext | null>(null);

  // Get papers that need processing
  const papersNeedingProcessing = useMemo(
    () => filterItemsNeedingProcessing(papers, context),
    [papers, context, filterItemsNeedingProcessing]
  );

  // Create a stable key for deduplication
  const batchKey = useMemo(
    () => computeBatchKey(papersNeedingProcessing, context),
    [papersNeedingProcessing, context, computeBatchKey]
  );

  // Stable callback for results - checks context hasn't changed
  const handleResults = useCallback(
    (paperId: string, result: TResult, expectedContext: TContext) => {
      if (JSON.stringify(expectedContext) === JSON.stringify(context)) {
        handleResult(paperId, result, expectedContext);
      }
    },
    [handleResult, context]
  );

  // Reset fetched keys and errors when reset dependencies change
  useEffect(() => {
    fetchedKeysRef.current.clear();
    setLoadingState(clearLoadingState());
    setErrors([]);
    contextAtFetchRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // Main effect to trigger batch operation
  useEffect(() => {
    // Guard conditions
    if (!canStart || !isConfigured || !batchKey) return;
    if (fetchedKeysRef.current.has(batchKey)) return;
    if (isFetchingRef.current) return;
    if (papersNeedingProcessing.length === 0) return;

    // Capture the context at fetch time to detect race conditions
    const contextAtFetch = context;
    contextAtFetchRef.current = contextAtFetch;

    // Mark as fetching
    fetchedKeysRef.current.add(batchKey);
    isFetchingRef.current = true;
    setErrors([]);
    setLoadingState(createLoadingState(papersNeedingProcessing));

    // Build input and execute
    const input = buildExecuteInput(papersNeedingProcessing, contextAtFetch);

    execute(input)
      .then(({ results, errors: batchErrors }) => {
        // Check if context changed while we were fetching
        if (JSON.stringify(contextAtFetchRef.current) !== JSON.stringify(contextAtFetch)) {
          console.warn("Context changed during fetch, discarding results");
          return;
        }

        // Process results
        Object.entries(results).forEach(([paperId, data]) => {
          handleResults(paperId, data, contextAtFetch);
        });

        // Store errors for UI feedback
        if (batchErrors.length > 0) {
          console.warn("Batch operation had partial failures:", batchErrors);
          setErrors(batchErrors);
        }
      })
      .catch((error) => {
        console.error("Batch operation failed:", error);
        // Remove from fetched so it can be retried
        fetchedKeysRef.current.delete(batchKey);
        setErrors([{ paperId: "batch", error: error.message || String(error) }]);
      })
      .finally(() => {
        isFetchingRef.current = false;
        setLoadingState(clearLoadingState());
      });
  }, [
    batchKey,
    canStart,
    isConfigured,
    execute,
    handleResults,
    papersNeedingProcessing,
    context,
    buildExecuteInput,
    createLoadingState,
    clearLoadingState,
  ]);

  return { loadingState, errors, isConfigured };
}
