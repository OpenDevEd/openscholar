import { useState, useCallback } from 'react';

export interface UseSelectionReturn<T extends string> {
  selectedIds: Set<T>;
  toggleSelect: (id: T) => void;
  toggleSelectAll: () => void;
  selectAllFiltered: (filteredIds: T[]) => void;
  clearSelection: () => void;
  setSelection: (ids: Set<T>) => void;
  allSelected: boolean;
  someSelected: boolean;
}

/**
 * Hook for managing selection state
 */
export function useSelection<T extends string>(items: T[]): UseSelectionReturn<T> {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(new Set());

  const toggleSelect = useCallback((id: T) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === items.length && items.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items));
    }
  }, [items, selectedIds.size]);

  const selectAllFiltered = useCallback((filteredIds: T[]) => {
    setSelectedIds(new Set(filteredIds));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const setSelection = useCallback((ids: Set<T>) => {
    setSelectedIds(new Set(ids));
  }, []);

  const allSelected = selectedIds.size === items.length && items.length > 0;
  const someSelected = selectedIds.size > 0 && selectedIds.size < items.length;

  return {
    selectedIds,
    toggleSelect,
    toggleSelectAll,
    selectAllFiltered,
    clearSelection,
    setSelection,
    allSelected,
    someSelected,
  };
}
