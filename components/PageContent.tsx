"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X, Trash2 } from "lucide-react";
import { startSearch } from "@/app/actions/openalex";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";

type SearchResult = {
  query: string;
  count: number;
};

const STORAGE_KEY = 'search-history';

function PageContent() {
  const [searchHistory, setSearchHistory] = useState<SearchResult[]>(() => {
    // Initialize from localStorage if available
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);

  // Update localStorage whenever searchHistory changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searchHistory));
  }, [searchHistory]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      const formData = new FormData(e.currentTarget);
      const count = await startSearch(formData);
      const query = formData.get('query') as string;
      setSearchHistory(prev => [...prev, { query, count }]);
      // Clear the form input after successful search
      (e.target as HTMLFormElement).reset();
    } finally {
      setIsLoading(false);
    }
  };

  const removeHistoryItem = (index: number) => {
    setSearchHistory(prev => prev.filter((_, i) => i !== index));
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const formatNumber = (num: number) => {
    return num.toLocaleString();
  };

  const totalCount = searchHistory.reduce((sum, item) => sum + item.count, 0);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-background">
      <div className="w-full max-w-xl space-y-6">
        <form onSubmit={handleSubmit} className="flex w-full items-center space-x-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              name="query"
              placeholder="Search papers..."
              className="pl-10"
              disabled={isLoading}
            />
          </div>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Searching...
              </>
            ) : (
              "Search"
            )}
          </Button>
        </form>

        {searchHistory.length > 0 && (
          <div suppressHydrationWarning className="w-full mt-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Results</h2>
              <Button
                variant="destructive"
                size="sm"
                onClick={clearHistory}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Clear All
              </Button>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Search Query</th>
                  <th className="text-right p-2">Count</th>
                  <th className="w-12 p-2"></th>
                </tr>
              </thead>
              <tbody>
                {searchHistory.map((result, index) => (
                  <tr key={index} className="border-b">
                    <td className="p-2">{result.query}</td>
                    <td className="text-right p-2">{formatNumber(result.count)}</td>
                    <td className="p-2 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeHistoryItem(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="p-2">Total</td>
                  <td className="text-right p-2">{formatNumber(totalCount)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

export default dynamic(() => Promise.resolve(PageContent), { ssr: false });