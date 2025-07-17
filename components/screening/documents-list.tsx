"use client";

import React, { useState } from 'react';
import { useScreeningStore } from '@/lib/store';
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
import { Trash2, FileText, User } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS_PER_PAGE = 10;

export function DocumentsList() {
  const { documents, removeDocument } = useScreeningStore();
  const [currentPage, setCurrentPage] = useState(1);

  if (documents.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No documents added yet</p>
        <p className="text-sm">Click "Add Document" to get started</p>
      </div>
    );
  }

  const totalPages = Math.ceil(documents.length / ITEMS_PER_PAGE);
  const paginatedDocuments = documents.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleRemoveDocument = (documentId: string) => {
    removeDocument(documentId);
    // If we're on the last page and it becomes empty, go to previous page
    const remainingDocuments = documents.length - 1;
    const newTotalPages = Math.ceil(remainingDocuments / ITEMS_PER_PAGE);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(newTotalPages);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {paginatedDocuments.map((document) => (
        <div 
          key={document.id} 
          className="group flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:border-border hover:bg-accent/30 transition-all duration-200"
        >
          {/* Left indicator */}
          <div className="w-1 h-12 bg-blue-500 rounded-full flex-shrink-0 mt-1" />
          
          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Title and year */}
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium text-sm leading-tight line-clamp-2 break-words" title={document.title}>
                {document.title}
              </h4>
              {document.publication_year && (
                <span className="text-xs text-muted-foreground font-medium flex-shrink-0 bg-muted px-2 py-0.5 rounded whitespace-nowrap">
                  {document.publication_year}
                </span>
              )}
            </div>
            
            {/* Authors */}
            {document.authorships && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">
                  {document.authorships
                    .slice(0, 3)
                    .map(authorship => authorship.author.display_name)
                    .join(', ')}
                  {document.authorships.length > 3 && ` +${document.authorships.length - 3} more`}
                </span>
              </div>
            )}
            
            {/* Metadata row - responsive layout */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
              {/* Badges row */}
              <div className="flex items-center gap-2 flex-wrap">
                {document.doi && (
                  <Badge variant="outline" className="text-xs h-5 px-1.5 flex-shrink-0">
                    DOI
                  </Badge>
                )}
                {document.open_access?.is_oa && document.open_access?.oa_url && (
                  <button
                    onClick={() => document.open_access?.oa_url && window.open(document.open_access.oa_url, '_blank')}
                    className="inline-flex items-center gap-1 text-xs h-5 px-1.5 text-green-600 border border-green-200 bg-transparent rounded-md hover:bg-green-50 hover:border-green-300 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/50 flex-shrink-0 cursor-pointer transition-colors duration-200 font-medium"
                    title="Click to open PDF"
                  >
                    <FileText className="h-3 w-3" />
                    Open Access
                  </button>
                )}
                {document.open_access?.is_oa && !document.open_access?.oa_url && (
                  <Badge variant="outline" className="text-xs h-5 px-1.5 text-green-600 border-green-200 flex-shrink-0">
                    Open Access
                  </Badge>
                )}
                {document.cited_by_count !== undefined && (
                  <span className="text-muted-foreground whitespace-nowrap">
                    {document.cited_by_count} citations
                  </span>
                )}
              </div>
              
              {/* Date row + actions */}
              <div className="flex items-center gap-2 sm:ml-auto whitespace-nowrap">
                <span className="text-muted-foreground">
                  Added {new Date(document.addedAt).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveDocument(document.id)}
                  className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                  title="Remove document"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          {/* Spacer to keep layout consistent */}
        </div>
      ))}
      </div>

      {/* Pagination */}
      {documents.length > ITEMS_PER_PAGE && (
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
    </div>
  );
} 