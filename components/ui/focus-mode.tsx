import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { 
  ChevronLeft, 
  ChevronRight, 
  X, 
  Star, 
  Users, 
  Quote, 
  TrendingUp, 
  BookOpen, 
  BarChart3, 
  Award, 
  Target, 
  Layers, 
  Building, 
  Leaf, 
  Unlock, 
  Lock, 
  Globe,
  Download,
  ExternalLink
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface FocusModeProps {
  isOpen: boolean;
  onClose: () => void;
  papers: any[];
  ratings: Record<string, number>;
  onRatingChange: (paperId: string, rating: string) => void;
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
}

export function FocusMode({
  isOpen,
  onClose,
  papers,
  ratings,
  onRatingChange,
  onDownloadItem,
  onDownloadEssentialItem
}: FocusModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentPaper = papers[currentIndex];

  useEffect(() => {
    setCurrentIndex(0);
  }, [isOpen]);

  // Notify Zotero when current paper changes
  useEffect(() => {
    if (isOpen && currentPaper) {
      document.dispatchEvent(new Event('ZoteroItemUpdated', {
        bubbles: true,
        cancelable: true
      }));
    }
  }, [currentPaper, isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
          // Focus the abstract container and let the browser handle scrolling
          const abstractContainer = document.querySelector('[data-abstract-scroll]') as HTMLElement;
          if (abstractContainer && !abstractContainer.matches(':focus')) {
            abstractContainer.focus();
          }
          // Don't prevent default - let the browser handle the scrolling
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          // Download JSON directly
          onDownloadItem(currentPaper, 'json');
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          window.open(currentPaper.id, '_blank');
          break;
        case 'a':
        case 'A':
          e.preventDefault();
          if (currentPaper.open_access?.oa_url) {
            window.open(currentPaper.open_access.oa_url, '_blank');
          }
          break;
        case 'x':
        case 'X':
          e.preventDefault();
          onRatingChange(currentPaper.id, "no-rating");
          break;
        case '0':
          e.preventDefault();
          onRatingChange(currentPaper.id, "0");
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          e.preventDefault();
          onRatingChange(currentPaper.id, e.key);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, papers.length, currentPaper]);

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % papers.length);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + papers.length) % papers.length);
  };

  const goToIndex = (index: number) => {
    setCurrentIndex(index);
  };

  if (!currentPaper) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-none p-0 overflow-hidden">
        <div className="flex flex-col h-full">
          {/* Compact Header */}
          <SheetHeader className="flex-shrink-0 p-3 border-b">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between w-full gap-2 md:gap-0">
              {/* First row: Focus Mode title + rating */}
              <div className="flex items-center justify-between md:justify-start gap-3">
                <div className="flex items-center gap-3">
                  <SheetTitle className="text-lg">Focus Mode</SheetTitle>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {currentIndex + 1} / {papers.length}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 mr-8 md:mr-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRatingChange(currentPaper.id, "no-rating")}
                      className="hover:scale-110 transition-transform relative"
                    >
                      <Star 
                        className={`h-3 w-3 ${
                          ratings[currentPaper.id] === undefined
                            ? 'text-yellow-400 hover:text-yellow-400' 
                            : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                        }`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-3 h-px bg-muted-foreground/60 rotate-45"></div>
                      </div>
                    </button>
                    <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">X</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onRatingChange(currentPaper.id, "0")}
                      className="hover:scale-110 transition-transform"
                    >
                      <Star 
                        className={`h-3 w-3 ${
                          ratings[currentPaper.id] === 0
                            ? 'text-yellow-400 hover:text-yellow-400' 
                            : 'text-muted-foreground hover:text-yellow-400'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">0</span>
                  </div>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <div key={star} className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const currentRating = ratings[currentPaper.id];
                          if (currentRating === star) {
                            // Remove rating if clicking the same star
                            onRatingChange(currentPaper.id, "no-rating");
                          } else {
                            // Set new rating
                            onRatingChange(currentPaper.id, star.toString());
                          }
                        }}
                        className="hover:scale-110 transition-transform"
                      >
                        <Star 
                          className={`h-3 w-3 ${
                            ratings[currentPaper.id] && ratings[currentPaper.id] >= star 
                              ? 'fill-yellow-400 text-yellow-400' 
                              : 'fill-muted-foreground text-muted-foreground hover:fill-yellow-400 hover:text-yellow-400'
                          }`}
                        />
                      </button>
                      <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">{star}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Second row: Navigation and actions */}
              <div className="flex items-center justify-center md:justify-end gap-1 md:mr-8">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={goToPrevious} disabled={papers.length <= 1}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">←</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={goToNext} disabled={papers.length <= 1}>
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">→</span>
                </div>
                <div className="w-px h-4 bg-border mx-1"></div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => window.open(currentPaper.id, '_blank')}>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">O</span>
                </div>
                <div className="flex items-center gap-1">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" data-download-trigger>
                        <Download className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onDownloadItem(currentPaper, 'json')}>
                        Download as JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDownloadItem(currentPaper, 'csv')}>
                        Download as CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDownloadEssentialItem(currentPaper, 'json')}>
                        Download Essential Info as JSON
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onDownloadEssentialItem(currentPaper, 'csv')}>
                        Download Essential Info as CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">D</span>
                </div>
              </div>
            </div>
          </SheetHeader>

          {/* Main Content - No Scroll */}
          <div className="flex-1 p-3 overflow-hidden">
            <div className="h-full flex flex-col pt-2">
              {/* COINS metadata span */}
              <span 
                className="Z3988" 
                title={`ctx_ver=Z39.88-2004&rft_val_fmt=info:ofi/fmt:kev:mtx:journal&rft.genre=article&rft.atitle=${encodeURIComponent(currentPaper.title || '')}&rft.jtitle=${encodeURIComponent(currentPaper.primary_location?.source?.display_name || '')}&rft.date=${currentPaper.publication_year || ''}&rft.volume=${encodeURIComponent(currentPaper.biblio?.volume || '')}&rft.issue=${encodeURIComponent(currentPaper.biblio?.issue || '')}&rft.spage=${encodeURIComponent(currentPaper.biblio?.first_page || '')}&rft.epage=${encodeURIComponent(currentPaper.biblio?.last_page || '')}&rft_id=info:doi/${encodeURIComponent(currentPaper.doi?.replace('https://doi.org/', '') || '')}&rft.au=${currentPaper.authorships?.map((auth: any) => encodeURIComponent(auth.author?.display_name || '')).join('&rft.au=') || ''}`}
              ></span>

              {/* Title & Year - Compact */}
              <div className="mb-2">
                <h1 className="text-lg font-bold leading-tight mb-1">
                  {currentPaper.title} ({currentPaper.publication_year})
                </h1>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {currentPaper.authorships && (
                    <span className="flex-1 truncate">
                      {currentPaper.authorships
                        .slice(0, 3)
                        .map((author: { author: { display_name: string } }) => author.author.display_name)
                        .join(', ')}
                      {currentPaper.authorships.length > 3 && ` +${currentPaper.authorships.length - 3} more`}
                    </span>
                  )}
                </div>
              </div>

              {/* Inline Metadata - Single Line Approach */}
              <div className="mb-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Refs:</span>
                    <span className="font-medium">{currentPaper.referenced_works_count || 0}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Cited:</span>
                    <span className="font-medium">{currentPaper.cited_by_count || 0}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">FWCI:</span>
                    <span className="font-medium">{currentPaper.fwci ? currentPaper.fwci.toFixed(2) : 'N/A'}</span>
                  </span>
                  {currentPaper.cited_by_percentile_year && (
                    <span className="flex items-center gap-1">
                      <Award className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">
                        {currentPaper.cited_by_percentile_year.min}-{currentPaper.cited_by_percentile_year.max}%
                      </span>
                    </span>
                  )}
                  {currentPaper.primary_topic && (
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">Topic:</span>
                      <span className="font-medium">{currentPaper.primary_topic.display_name}</span>
                    </span>
                  )}
                  {currentPaper.primary_topic?.field && (
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">Field:</span>
                      <span className="font-medium">{currentPaper.primary_topic.field.display_name}</span>
                    </span>
                  )}
                  {currentPaper.primary_topic?.subfield && (
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">Subfield:</span>
                      <span className="font-medium">{currentPaper.primary_topic.subfield.display_name}</span>
                    </span>
                  )}
                  {currentPaper.primary_topic?.domain && (
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">Domain:</span>
                      <span className="font-medium">{currentPaper.primary_topic.domain.display_name}</span>
                    </span>
                  )}
                  {currentPaper.open_access && (
                    <span className="flex items-center gap-1">
                      {currentPaper.open_access.is_oa ? (
                        <>
                          <Unlock className="h-3 w-3 text-green-600" />
                          <span className="text-green-600 font-medium">Open</span>
                          {currentPaper.open_access.oa_url && (
                            <>
                              <a 
                                href={currentPaper.open_access.oa_url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                <Globe className="h-3 w-3" />
                              </a>
                              <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">A</span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <Lock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-muted-foreground font-medium">Closed</span>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* Topic & SDGs - Compact Row */}
              <div className="mb-2 text-xs space-y-1">
                {currentPaper.sustainable_development_goals && currentPaper.sustainable_development_goals.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-muted-foreground">SDGs:</span>
                    {currentPaper.sustainable_development_goals.slice(0, 2).map((sdg: { id: string; display_name: string; score: number }) => (
                      <span 
                        key={sdg.id}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
                        title={`${sdg.display_name} (Score: ${sdg.score?.toFixed(2) || 'N/A'})`}
                      >
                        {sdg.display_name}
                        {sdg.score && (
                          <span className="text-green-600 font-medium">
                            {sdg.score.toFixed(2)}
                          </span>
                        )}
                      </span>
                    ))}
                    {currentPaper.sustainable_development_goals.length > 2 && (
                      <span className="text-muted-foreground">
                        +{currentPaper.sustainable_development_goals.length - 2} more
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Abstract - Takes Remaining Space */}
              {currentPaper.abstract && (
                <div className="flex-1 min-h-0 border-t pt-2">
                  <div className="text-sm font-medium text-muted-foreground mb-1">Abstract</div>
                  <div className="text-sm leading-relaxed overflow-y-auto h-full pr-2" data-abstract-scroll tabIndex={0}>
                    {currentPaper.abstract}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
} 