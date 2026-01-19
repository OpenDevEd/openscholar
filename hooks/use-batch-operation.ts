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
  /** Stable context ID for comparison (avoids JSON.stringify on every render) */
  contextId: string;
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
 * 3. Clears the ref when contextId changes
 * 4. Uses contextId for O(1) comparison instead of JSON.stringify
 * 5. Exposes errors for UI feedback
 */
export function useBatchOperation<TInput, TResult, TContext, TLoadingState>({
  execute,
  isConfigured,
  computeBatchKey,
  filterItemsNeedingProcessing,
  buildExecuteInput,
  handleResult,
  contextId,
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
  const contextIdAtFetchRef = useRef<string | null>(null);

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

  // Stable callback for results - checks context hasn't changed using contextId
  const handleResults = useCallback(
    (paperId: string, result: TResult, expectedContextId: string) => {
      if (expectedContextId === contextId) {
        handleResult(paperId, result, context);
      }
    },
    [handleResult, context, contextId]
  );

  // Reset fetched keys and errors when contextId changes
  useEffect(() => {
    fetchedKeysRef.current.clear();
    setLoadingState(clearLoadingState());
    setErrors([]);
    contextIdAtFetchRef.current = null;
  }, [contextId, clearLoadingState]);

  // Main effect to trigger batch operation
  useEffect(() => {
    // Guard conditions
    if (!canStart || !isConfigured || !batchKey) return;
    if (fetchedKeysRef.current.has(batchKey)) return;
    if (isFetchingRef.current) return;
    if (papersNeedingProcessing.length === 0) return;

    // Capture the contextId at fetch time to detect race conditions
    const contextIdAtFetch = contextId;
    contextIdAtFetchRef.current = contextIdAtFetch;

    // Mark as fetching
    fetchedKeysRef.current.add(batchKey);
    isFetchingRef.current = true;
    setErrors([]);
    setLoadingState(createLoadingState(papersNeedingProcessing));

    // Build input and execute
    const input = buildExecuteInput(papersNeedingProcessing, context);

    execute(input)
      .then(({ results, errors: batchErrors }) => {
        // Check if context changed while we were fetching (O(1) string comparison)
        if (contextIdAtFetchRef.current !== contextIdAtFetch) {
          return;
        }

        // Process results
        Object.entries(results).forEach(([paperId, data]) => {
          handleResults(paperId, data, contextIdAtFetch);
        });

        // Store errors for UI feedback
        if (batchErrors.length > 0) {
          setErrors(batchErrors);
        }
      })
      .catch((error) => {
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
    contextId,
    buildExecuteInput,
    createLoadingState,
    clearLoadingState,
  ]);

  return { loadingState, errors, isConfigured };
}
