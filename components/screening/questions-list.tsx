"use client";

import React, { useState } from 'react';
import { useScreeningStore, type ScreeningQuestion, type ScreeningQuestionType } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Trash2, HelpCircle, Hash, Type, List, ToggleLeft, Pencil } from 'lucide-react';
import { AddQuestionDialog } from '@/components/screening/add-question-dialog';
import { cn } from '@/lib/utils';

const ITEMS_PER_PAGE = 8;

const getTypeIcon = (type: ScreeningQuestionType) => {
  switch (type) {
    case 'boolean':
      return <ToggleLeft className="h-3 w-3" />;
    case 'number':
      return <Hash className="h-3 w-3" />;
    case 'string':
      return <Type className="h-3 w-3" />;
    case 'array':
      return <List className="h-3 w-3" />;
    default:
      return <HelpCircle className="h-3 w-3" />;
  }
};

const getTypeBadgeColor = (type: ScreeningQuestionType) => {
  switch (type) {
    case 'boolean':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'number':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'string':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'array':
      return 'bg-orange-100 text-orange-800 border-orange-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

export function QuestionsList() {
  const { questions, removeQuestion } = useScreeningStore();
  const [currentPage, setCurrentPage] = useState(1);
  const [editingQuestion, setEditingQuestion] = useState<ScreeningQuestion | null>(null);

  if (questions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No questions added yet</p>
        <p className="text-sm">Click "Add Question" or "Import" to get started</p>
      </div>
    );
  }

  const totalPages = Math.ceil(questions.length / ITEMS_PER_PAGE);
  const paginatedQuestions = questions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleRemoveQuestion = (questionId: string) => {
    removeQuestion(questionId);
    // If we're on the last page and it becomes empty, go to previous page
    const remainingQuestions = questions.length - 1;
    const newTotalPages = Math.ceil(remainingQuestions / ITEMS_PER_PAGE);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {paginatedQuestions.map((question) => (
          <div 
            key={question.id} 
            className="group flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/30 transition-all duration-200"
          >
            {/* Left indicator */}
            <div className="w-1 h-10 bg-green-500 rounded-full flex-shrink-0 mt-1" />
            
            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Type badge and key - responsive layout */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Badge 
                  variant="outline" 
                  className={`text-xs h-5 px-1.5 flex-shrink-0 w-fit ${getTypeBadgeColor(question.type)}`}
                >
                  <span className="mr-1">{getTypeIcon(question.type)}</span>
                  {question.type}
                </Badge>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground break-all">
                  {question.key}
                </code>
              </div>
              
              {/* Question text */}
              <p className="text-sm font-medium leading-tight line-clamp-2 break-words" title={question.question}>
                {question.question}
              </p>
            </div>
            
            {/* Action buttons */}
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingQuestion(question)}
                className="text-muted-foreground hover:text-foreground flex-shrink-0 h-8 w-8 p-0"
                title="Edit question"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveQuestion(question.id)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0 h-8 w-8 p-0"
                title="Remove question"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {questions.length > ITEMS_PER_PAGE && (
        <div className="flex justify-center pt-4">
          <Pagination>
            <PaginationContent className="flex-wrap justify-center gap-1">
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  className={cn(
                    "cursor-pointer text-xs sm:text-sm",
                    currentPage === 1 && "pointer-events-none opacity-50"
                  )}
                />
              </PaginationItem>
              
              {/* Show page numbers - simplified for mobile */}
              {totalPages <= 5 ? (
                // Show all pages if 5 or fewer
                Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      onClick={() => handlePageChange(page)}
                      isActive={currentPage === page}
                      className="cursor-pointer text-xs sm:text-sm min-w-[32px] h-8"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))
              ) : (
                // Show simplified pagination for mobile
                <>
                  {/* Always show first page */}
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => handlePageChange(1)}
                      isActive={currentPage === 1}
                      className="cursor-pointer text-xs sm:text-sm min-w-[32px] h-8"
                    >
                      1
                    </PaginationLink>
                  </PaginationItem>
                  
                  {/* Show ellipsis if current page is far from start */}
                  {currentPage > 3 && (
                    <PaginationItem>
                      <span className="px-2 py-2 text-xs">...</span>
                    </PaginationItem>
                  )}
                  
                  {/* Show current page and neighbors */}
                  {Array.from(
                    { length: Math.min(3, totalPages - 2) },
                    (_, i) => {
                      const page = Math.max(2, Math.min(totalPages - 1, currentPage - 1 + i));
                      return page;
                    }
                  )
                    .filter((page, index, array) => array.indexOf(page) === index) // Remove duplicates
                    .filter(page => page > 1 && page < totalPages) // Exclude first and last
                    .map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => handlePageChange(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer text-xs sm:text-sm min-w-[32px] h-8"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                  
                  {/* Show ellipsis if current page is far from end */}
                  {currentPage < totalPages - 2 && (
                    <PaginationItem>
                      <span className="px-2 py-2 text-xs">...</span>
                    </PaginationItem>
                  )}
                  
                  {/* Always show last page */}
                  {totalPages > 1 && (
                    <PaginationItem>
                      <PaginationLink
                        onClick={() => handlePageChange(totalPages)}
                        isActive={currentPage === totalPages}
                        className="cursor-pointer text-xs sm:text-sm min-w-[32px] h-8"
                      >
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  )}
                </>
              )}
              
              <PaginationItem>
                <PaginationNext
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  className={cn(
                    "cursor-pointer text-xs sm:text-sm",
                    currentPage === totalPages && "pointer-events-none opacity-50"
                  )}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
      {/* Edit Dialog */}
      <AddQuestionDialog 
        open={!!editingQuestion}
        onOpenChange={(open) => {
          if (!open) setEditingQuestion(null);
        }}
        question={editingQuestion}
      />
    </div>
  );
} 