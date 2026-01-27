"use client";

import React, { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Search, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

interface SourceManualProps {
  analysisId: Id<"analyses">;
  onSuccess?: () => void;
}

export function SourceManual({ analysisId, onSuccess }: SourceManualProps) {
  const [title, setTitle] = useState("");
  const [abstract, setAbstract] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [doi, setDoi] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [addedCount, setAddedCount] = useState(0);

  const addManualDocument = useMutation(
    api.extraction.sources.addManualDocument,
  );

  const handleDoiLookup = async () => {
    if (!doi.trim()) {
      toast.error("Please enter a DOI");
      return;
    }

    setIsLookingUp(true);
    try {
      // Clean DOI
      const cleanDoi = doi
        .trim()
        .replace("https://doi.org/", "")
        .replace("http://doi.org/", "");

      // Lookup via OpenAlex
      const response = await fetch(
        `https://api.openalex.org/works/doi:${encodeURIComponent(cleanDoi)}`,
      );

      if (!response.ok) {
        throw new Error("DOI not found");
      }

      const work = await response.json();

      // Fill in fields
      setTitle(work.title || work.display_name || "");
      setAbstract(work.abstract || "");
      setAuthors(
        work.authorships
          ?.map((a: any) => a.author?.display_name)
          .filter(Boolean)
          .join(", ") || "",
      );
      setYear(work.publication_year?.toString() || "");
      setDoi(cleanDoi);

      toast.success("Metadata loaded from DOI");
    } catch (error) {
      console.error("DOI lookup failed:", error);
      toast.error("Could not find paper with this DOI");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleAdd = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }

    setIsAdding(true);
    try {
      await addManualDocument({
        analysisId,
        title: title.trim(),
        abstract: abstract.trim() || undefined,
        authors: authors
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        year: year ? parseInt(year, 10) : undefined,
        doi: doi.trim() || undefined,
      });

      toast.success("Document added");
      setAddedCount((c) => c + 1);

      // Clear form for next entry
      setTitle("");
      setAbstract("");
      setAuthors("");
      setYear("");
      setDoi("");
    } catch (error: any) {
      console.error("Add failed:", error);
      toast.error(error.message || "Failed to add document");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDone = () => {
    onSuccess?.();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-auto space-y-4">
        {/* DOI Lookup */}
        <div className="space-y-2">
          <Label htmlFor="doi">DOI (optional - auto-fills metadata)</Label>
          <div className="flex gap-2">
            <Input
              id="doi"
              placeholder="10.1000/xyz123"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
              disabled={isLookingUp || isAdding}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleDoiLookup}
              disabled={isLookingUp || !doi.trim()}
            >
              {isLookingUp ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="title">Title *</Label>
          <Input
            id="title"
            placeholder="Paper title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isAdding}
          />
        </div>

        {/* Authors */}
        <div className="space-y-2">
          <Label htmlFor="authors">Authors (comma-separated)</Label>
          <Input
            id="authors"
            placeholder="John Doe, Jane Smith"
            value={authors}
            onChange={(e) => setAuthors(e.target.value)}
            disabled={isAdding}
          />
        </div>

        {/* Year */}
        <div className="space-y-2">
          <Label htmlFor="year">Year</Label>
          <Input
            id="year"
            type="number"
            placeholder="2024"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            disabled={isAdding}
            className="w-32"
          />
        </div>

        {/* Abstract */}
        <div className="space-y-2">
          <Label htmlFor="abstract">Abstract</Label>
          <Textarea
            id="abstract"
            placeholder="Paper abstract..."
            value={abstract}
            onChange={(e) => setAbstract(e.target.value)}
            disabled={isAdding}
            rows={4}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t mt-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {addedCount > 0 && (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{addedCount} document(s) added</span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleAdd}
            disabled={isAdding || !title.trim()}
          >
            {isAdding && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add & Continue
          </Button>
          {addedCount > 0 && <Button onClick={handleDone}>Done</Button>}
        </div>
      </div>
    </div>
  );
}
