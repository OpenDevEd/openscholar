import React from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Search, Loader2 } from "lucide-react";
import { Logo } from "./logo";

interface HomeSearchProps {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
}

export function HomeSearch({ onSubmit, isLoading }: HomeSearchProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-2xl space-y-8">
        {/* Logo */}
        <div className="text-center">
          <Logo size="xl" className="justify-center mb-8" context="home" />
          <p className="text-muted-foreground text-lg">
            Search millions of academic papers and research articles
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={onSubmit} className="w-full">
          <div className="relative">
            <div className="flex w-full items-center space-x-2 p-2 border rounded-full shadow-lg hover:shadow-xl transition-shadow bg-background">
              <Search className="h-5 w-5 text-muted-foreground ml-4" />
              <Textarea
                name="query"
                placeholder="Search for papers, authors, topics..."
                className="flex-1 border-0 bg-transparent resize-none min-h-[48px] max-h-32 focus-visible:ring-0 focus-visible:ring-offset-0 text-lg"
                disabled={isLoading}
                onKeyDown={handleKeyDown}
              />
              <Button 
                type="submit" 
                disabled={isLoading} 
                className="rounded-full h-12 w-12 mr-2"
                size="icon"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Search className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </form>

        {/* Quick Actions */}
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            Try searching for topics like "machine learning", "climate change", or "quantum computing"
          </p>
        </div>
      </div>
    </div>
  );
} 