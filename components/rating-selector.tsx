import React from 'react';
import { Star } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRatingsStore } from "@/lib/store";

interface RatingSelectorProps {
  paperId: string;
}

export function RatingSelector({ paperId }: RatingSelectorProps) {
  const { ratings, setRating } = useRatingsStore();

  const handleRatingChange = (rating: string) => {
    if (rating === "no-rating") {
      setRating(paperId, null);
    } else {
      setRating(paperId, parseInt(rating));
    }
  };

  return (
    <div className="flex items-center gap-3 mb-3">
      <Select
        value={ratings[paperId]?.toString() || "no-rating"}
        onValueChange={handleRatingChange}
      >
        <SelectTrigger className="min-w-48">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="no-rating">No Rating</SelectItem>
          <SelectItem value="0">☆ 0 Stars</SelectItem>
          <SelectItem value="1">⭐ 1 Star</SelectItem>
          <SelectItem value="2">⭐⭐ 2 Stars</SelectItem>
          <SelectItem value="3">⭐⭐⭐ 3 Stars</SelectItem>
          <SelectItem value="4">⭐⭐⭐⭐ 4 Stars</SelectItem>
          <SelectItem value="5">⭐⭐⭐⭐⭐ 5 Stars</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
} 