import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  ExternalLink,
  Settings,
  RotateCcw
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { workToCoins, cn, getEffectiveSearchId } from '@/lib/utils';
import { useRatingsStore, useFocusModeSettingsStore, useUIStore, useTranslationStore, useSearchHistoryStore } from '@/lib/store';
import { DownloadMenu } from "../download-menu";
import { useTheme } from 'next-themes';
import { RatingSelector } from "../rating-selector";
import { useIsMobile } from '@/lib/hooks';
import { writeFile, writeFileSync } from 'fs';

interface FocusModeProps {
  isOpen: boolean;
  onClose: () => void;
  papers: any[];
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
}

export function FocusMode({
  isOpen,
  onClose,
  papers,
  onDownloadItem,
  onDownloadEssentialItem
}: FocusModeProps) {
  const { focusModeIndex: currentIndex, setFocusModeIndex: setCurrentIndex } = useUIStore();
  const [showSettings, setShowSettings] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const { ratings, setRating } = useRatingsStore();
  const settings = useFocusModeSettingsStore();
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const pathname = usePathname();

  // Translation store
  const { getTranslation } = useTranslationStore();
  const [showTranslated, setShowTranslated] = useState(false);

  const currentPaper = papers[currentIndex];
  console.log(currentPaper);
  const translatedContent = getTranslation(currentPaper?.id);

  // Get selected language for translation
  const selectedLanguage = useSearchHistoryStore((state) => {
    const searchId = getEffectiveSearchId(pathname, undefined);
    const currentResult = searchId ? state.searchHistory.find((item) => item.id === searchId) : null;
    return currentResult?.language || "";
  });

  // Swipe threshold for triggering navigation - made more restrictive
  const swipeThreshold = 120; // Increased from 50
  const swipeVelocityThreshold = 800; // Increased from 500

  // Helper functions for styling based on settings
  const getFontSizeClass = () => {
    return cn(
      settings.fontSize === 'sm' && 'text-sm',
      settings.fontSize === 'base' && 'text-base',
      settings.fontSize === 'lg' && 'text-lg',
      settings.fontSize === 'xl' && 'text-xl',
      !['sm', 'base', 'lg', 'xl'].includes(settings.fontSize) && 'text-base' // default fallback
    );
  };

  const getLineHeightClass = () => {
    return cn(
      settings.lineHeight === 'tight' && 'leading-tight',
      settings.lineHeight === 'normal' && 'leading-normal',
      settings.lineHeight === 'relaxed' && 'leading-relaxed',
      !['tight', 'normal', 'relaxed'].includes(settings.lineHeight) && 'leading-normal' // default fallback
    );
  };

  const getMaxWidthClass = () => {
    return cn(
      settings.maxContentWidth === 'narrow' && 'max-w-2xl',
      settings.maxContentWidth === 'medium' && 'max-w-4xl',
      settings.maxContentWidth === 'wide' && 'max-w-6xl',
      settings.maxContentWidth === 'full' && 'max-w-none',
      !['narrow', 'medium', 'wide', 'full'].includes(settings.maxContentWidth) && 'max-w-4xl' // default fallback
    );
  };

  const getContainerClasses = () => {
    const baseClasses = "flex-1 overflow-y-auto overflow-x-hidden focus:outline-none";
    return baseClasses;
  };

  const getContentClasses = () => {
    return cn(
      "min-h-full flex flex-col mx-auto",
      getMaxWidthClass(),
      settings.compactMode ? "p-3" : "p-6",
      settings.compactMode ? "space-y-1" : "space-y-2"
    );
  };

  useEffect(() => {
    setShowSettings(false);
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

  // Reset scroll position when paper changes
  useEffect(() => {
    if (isOpen && !showSettings) {
      const contentContainer = document.querySelector('[data-content-scroll]') as HTMLElement;
      if (contentContainer) {
        contentContainer.scrollTop = 0;
      }
    }
  }, [currentIndex, isOpen, showSettings]);

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
          const abstractContainer = document.querySelector('[data-content-scroll]') as HTMLElement;
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
          handleRatingChange(currentPaper.id, "no-rating");
          break;
        case '0':
          e.preventDefault();
          handleRatingChange(currentPaper.id, "0");
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          e.preventDefault();
          handleRatingChange(currentPaper.id, e.key);
          break;
        case 's':
        case 'S':
          e.preventDefault();
          setShowSettings(!showSettings);
          break;
        case 't':
        case 'T':
          e.preventDefault();
          if (selectedLanguage && selectedLanguage !== "en" && translatedContent) {
            setShowTranslated(!showTranslated);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, papers.length, currentPaper, selectedLanguage, translatedContent, showTranslated]);

  const goToNext = () => {
    if (currentIndex < papers.length - 1) {
      if (isMobile) {
        setSwipeDirection('left');
      }
      setCurrentIndex(currentIndex + 1);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      if (isMobile) {
        setSwipeDirection('right');
      }
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goToIndex = (index: number) => {
    if (index !== currentIndex) {
      if (isMobile) {
        setSwipeDirection(index > currentIndex ? 'left' : 'right');
      }
      setCurrentIndex(index);
    }
  };

  const handleRatingChange = (paperId: string, rating: string) => {
    if (rating === "no-rating") {
      setRating(paperId, null);
    } else {
      setRating(paperId, parseInt(rating));
    }
  };

  // Swipe handlers
  const handleDragEnd = (event: any, info: PanInfo) => {
    const { offset, velocity } = info;
    
    // More restrictive swipe detection
    const horizontalDistance = Math.abs(offset.x);
    const verticalDistance = Math.abs(offset.y);
    const horizontalVelocity = Math.abs(velocity.x);
    const verticalVelocity = Math.abs(velocity.y);
    
    // Only trigger swipe if:
    // 1. Horizontal movement is significantly more than vertical (intentional horizontal swipe)
    // 2. Meets distance OR velocity threshold
    // 3. Horizontal velocity is greater than vertical velocity (horizontal intent)
    const isHorizontalSwipe = horizontalDistance > verticalDistance * 1.5;
    const meetsThreshold = horizontalDistance > swipeThreshold || horizontalVelocity > swipeVelocityThreshold;
    const isHorizontalIntent = horizontalVelocity > verticalVelocity;
    
    const shouldSwipe = isHorizontalSwipe && meetsThreshold && isHorizontalIntent;
    
    if (shouldSwipe) {
      if (offset.x > 0 && currentIndex > 0) {
        // Swipe right - go to previous
        goToPrevious();
      } else if (offset.x < 0 && currentIndex < papers.length - 1) {
        // Swipe left - go to next
        goToNext();
      }
    }
  };

  // Reusable Paper Content Component
  const PaperContent = ({
    paper,
    isPreview = false
  }: {
    paper: any;
    isPreview?: boolean
  }) => {
    const paperTranslatedContent = getTranslation(paper?.id);
    return (
      <div className={getContentClasses()}>
        {/* COINS metadata span - only for main content */}
        {!isPreview && (
          <span 
            className="Z3988" 
            title={workToCoins(paper)}
            style={{ display: 'none' }}
          ></span>
        )}

        {/* Title & Year - Compact */}
        <div className={cn(
          settings.compactMode ? "mb-1" : "mb-2"
        )}>
            <h1 className={cn("font-bold leading-tight mb-1", getFontSizeClass())}>
            {isPreview
              ? "The Impact of Machine Learning on Scientific Research Discovery (2024)"
              : showTranslated && paperTranslatedContent
                ? `${paperTranslatedContent.translatedTitle} (${paper.publication_year})`
                : `${paper.title} (${paper.publication_year})`
            }
          </h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {isPreview ? (
              <span className="flex-1 truncate">
                Smith, J., Johnson, A., Williams, R. +3 more
              </span>
            ) : (
              paper.authorships && (
                <span className="flex-1 truncate">
                  {paper.authorships
                    .slice(0, 3)
                    .map((author: { author: { display_name: string } }) => author.author.display_name)
                    .join(', ')}
                  {paper.authorships.length > 3 && ` +${paper.authorships.length - 3} more`}
                </span>
              )
            )}
          </div>
        </div>

        {/* Inline Metadata - Single Line Approach */}
        {settings.showMetadata && (
          <div className={cn(
            settings.compactMode ? "mb-1 text-xs" : "mb-2 text-xs"
          )}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">Refs:</span>
                <span className="font-medium">{isPreview ? "127" : (paper.referenced_works_count || 0)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">Cited:</span>
                <span className="font-medium">{isPreview ? "89" : (paper.cited_by_count || 0)}</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="text-muted-foreground">FWCI:</span>
                <span className="font-medium">{isPreview ? "2.34" : (paper.fwci ? paper.fwci.toFixed(2) : 'N/A')}</span>
              </span>
              {(isPreview || paper.cited_by_percentile_year) && (
                <span className="flex items-center gap-1">
                  <Award className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">
                    {isPreview ? "85-95%" : `${paper.cited_by_percentile_year.min}-${paper.cited_by_percentile_year.max}%`}
                  </span>
                </span>
              )}
              {(isPreview || paper.primary_topic) && (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">Topic:</span>
                  <span className="font-medium">
                    {isPreview ? "Machine Learning Applications" : paper.primary_topic.display_name}
                  </span>
                </span>
              )}
              {!isPreview && paper.primary_topic?.field && (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">Field:</span>
                  <span className="font-medium">{paper.primary_topic.field.display_name}</span>
                </span>
              )}
              {!isPreview && paper.primary_topic?.subfield && (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">Subfield:</span>
                  <span className="font-medium">{paper.primary_topic.subfield.display_name}</span>
                </span>
              )}
              {!isPreview && paper.primary_topic?.domain && (
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">Domain:</span>
                  <span className="font-medium">{paper.primary_topic.domain.display_name}</span>
                </span>
              )}
              {!isPreview && paper.open_access && (
                <span className="flex items-center gap-1">
                  {paper.open_access.is_oa ? (
                    <>
                      <Unlock className="h-3 w-3 text-green-600" />
                      <span className="text-green-600 font-medium">Open</span>
                      {paper.open_access.oa_url && (
                        <>
                          <a 
                            href={paper.open_access.oa_url} 
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
        )}

        {/* Topic & SDGs - Compact Row */}
        {settings.showMetadata && !isPreview && (
          <div className={cn(
            settings.compactMode ? "mb-1 text-xs space-y-1" : "mb-2 text-xs space-y-1"
          )}>
            {paper.sustainable_development_goals && paper.sustainable_development_goals.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-muted-foreground">SDGs:</span>
                {paper.sustainable_development_goals.slice(0, 2).map((sdg: { id: string; display_name: string; score: number }) => (
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
                {paper.sustainable_development_goals.length > 2 && (
                  <span className="text-muted-foreground">
                    +{paper.sustainable_development_goals.length - 2} more
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Abstract - Takes Remaining Space */}
        {(paper.abstract || isPreview) && (
          <div className="border-t pt-2">
            <div className="text-sm font-medium text-muted-foreground mb-1">Abstract</div>
            <div
              className={cn("pr-2", getFontSizeClass(), getLineHeightClass())}
            >
              {isPreview
                ? "This study examines the transformative impact of machine learning algorithms on modern scientific research methodologies. We analyze how automated data processing, pattern recognition, and predictive modeling have revolutionized hypothesis generation and experimental design across multiple disciplines. Our findings demonstrate significant improvements in research efficiency and discovery rates when ML techniques are properly integrated into traditional scientific workflows."
                : showTranslated && paperTranslatedContent
                  ? paperTranslatedContent.translatedAbstract
                  : paper.abstract
              }
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!currentPaper) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-none p-0 overflow-hidden !outline-none">
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
                {/* Star rating buttons - hidden on mobile */}
                <div className="hidden md:flex items-center gap-0.5 mr-8 md:mr-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRatingChange(currentPaper.id, "no-rating")}
                      className="hover:scale-110 transition-transform relative"
                    >
                      <Star 
                        className={cn(
                          "h-3 w-3",
                          ratings[currentPaper.id] === undefined
                            ? 'text-yellow-400 hover:text-yellow-400' 
                            : 'text-muted-foreground/40 hover:text-muted-foreground/60'
                        )}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-3 h-px bg-muted-foreground/60 rotate-45"></div>
                      </div>
                    </button>
                    <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">X</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleRatingChange(currentPaper.id, "0")}
                      className="hover:scale-110 transition-transform"
                    >
                      <Star 
                        className={cn(
                          "h-3 w-3",
                          ratings[currentPaper.id] === 0
                            ? 'text-yellow-400 hover:text-yellow-400' 
                            : 'text-muted-foreground hover:text-yellow-400'
                        )}
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
                            handleRatingChange(currentPaper.id, "no-rating");
                          } else {
                            // Set new rating
                            handleRatingChange(currentPaper.id, star.toString());
                          }
                        }}
                        className="hover:scale-110 transition-transform"
                      >
                        <Star 
                          className={cn(
                            "h-3 w-3",
                            ratings[currentPaper.id] && ratings[currentPaper.id] >= star 
                              ? 'fill-yellow-400 text-yellow-400' 
                              : 'fill-muted-foreground text-muted-foreground hover:fill-yellow-400 hover:text-yellow-400'
                          )}
                        />
                      </button>
                      <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">{star}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Second row: Navigation and actions */}
              <div className="flex items-center justify-center md:justify-end gap-1 md:mr-8">
                {/* Compact rating selector - only on mobile */}
                <div className="md:hidden">
                  <RatingSelector paperId={currentPaper.id} variant="compact" />
                </div>
                <div className="w-px h-4 bg-border mx-1 md:hidden"></div>
                
                <div className="flex items-center gap-1">
                  {(selectedLanguage && selectedLanguage !== "en") && (
                    <>
                      <Button
                        variant={showTranslated ? "outline-primary" : "outline"}
                        size="sm"
                        onClick={() => setShowTranslated(!showTranslated)}
                        title={showTranslated ? "Show Original" : "Show English Translation"}
                        disabled={!translatedContent}
                      >
                        <Globe className="h-3 w-3 md:mr-1" />
                        <span className="hidden sm:inline">
                          {showTranslated ? "Original" : "English"}
                        </span>
                      </Button>
                      <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">T</span>
                    </>
                  )}
                  <div className="w-px h-4 bg-border mx-1 hidden md:block"></div>
                  <Button
                    variant={showSettings ? "outline-primary" : "outline"}
                    size="sm"
                    onClick={() => setShowSettings(!showSettings)}
                  >
                    <Settings className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">S</span>
                </div>
                <div className="w-px h-4 bg-border mx-1"></div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={goToPrevious} disabled={currentIndex === 0}>
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">←</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={goToNext} disabled={currentIndex === papers.length - 1}>
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
                  <DownloadMenu
                    variant="icon"
                    onDownloadJSON={() => onDownloadItem(currentPaper, 'json')}
                    onDownloadCSV={() => onDownloadItem(currentPaper, 'csv')}
                    onDownloadEssentialJSON={() => onDownloadEssentialItem(currentPaper, 'json')}
                    onDownloadEssentialCSV={() => onDownloadEssentialItem(currentPaper, 'csv')}
                  />
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded hidden md:inline">D</span>
                </div>
              </div>
            </div>
          </SheetHeader>

          {/* Main Content */}
          <div className={getContainerClasses()} tabIndex={0}>
            {showSettings ? (
              /* Settings Panel */
              <div className="h-full overflow-y-auto !outline-none" data-content-scroll tabIndex={0} >
                <div className={cn("mx-auto p-6", getMaxWidthClass())}>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-bold tracking-tight">Focus Mode Settings</h2>
                      <p className="text-muted-foreground mt-1">Customize your reading experience</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={settings.resetSettings}
                      className="gap-2"
                      title="Reset to defaults"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Settings Controls */}
                    <div className="space-y-8">
                      {/* Typography Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">Typography</h3>
                          <p className="text-sm text-muted-foreground">Adjust text appearance for optimal readability</p>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Font Size</Label>
                            <Select value={settings.fontSize} onValueChange={settings.setFontSize}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sm">Small (14px)</SelectItem>
                                <SelectItem value="base">Medium (16px)</SelectItem>
                                <SelectItem value="lg">Large (18px)</SelectItem>
                                <SelectItem value="xl">Extra Large (20px)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Line Height</Label>
                            <Select value={settings.lineHeight} onValueChange={settings.setLineHeight}>
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="tight">Tight (1.25)</SelectItem>
                                <SelectItem value="normal">Normal (1.5)</SelectItem>
                                <SelectItem value="relaxed">Relaxed (1.75)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Layout Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">Layout</h3>
                          <p className="text-sm text-muted-foreground">Control content width and spacing - notice how this page width changes too!</p>
                        </div>
                        
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Content Width</Label>
                          <Select value={settings.maxContentWidth} onValueChange={settings.setMaxContentWidth}>
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="narrow">Narrow (600px)</SelectItem>
                              <SelectItem value="medium">Medium (800px)</SelectItem>
                              <SelectItem value="wide">Wide (1000px)</SelectItem>
                              <SelectItem value="full">Full Width</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Appearance Section */}
                      <div className="space-y-6">
                        <div>
                          <h3 className="text-lg font-semibold mb-1">Appearance</h3>
                          <p className="text-sm text-muted-foreground">Customize the visual theme and information density</p>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">Dark Mode</Label>
                              <p className="text-xs text-muted-foreground">Switch to dark theme for better reading in low light</p>
                            </div>
                            <Switch
                              checked={theme === 'dark'}
                              onCheckedChange={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">Show Metadata</Label>
                              <p className="text-xs text-muted-foreground">Display citation counts, topics, and other paper details</p>
                            </div>
                            <Switch
                              checked={settings.showMetadata}
                              onCheckedChange={settings.setShowMetadata}
                            />
                          </div>

                          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="space-y-0.5">
                              <Label className="text-sm font-medium">Compact Mode</Label>
                              <p className="text-xs text-muted-foreground">Reduce spacing for a denser layout</p>
                            </div>
                            <Switch
                              checked={settings.compactMode}
                              onCheckedChange={settings.setCompactMode}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Preview Section */}
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-1">Preview</h3>
                        <p className="text-sm text-muted-foreground">See how your settings will look</p>
                      </div>
                      
                      <div className="rounded-lg border bg-background">
                        <PaperContent paper={currentPaper} isPreview={true} />
                      </div>
                    </div>
                  </div>

                  {/* Back Button */}
                  <div className="mt-8 pt-6 border-t">
                    <Button 
                      onClick={() => setShowSettings(false)}
                      className="w-full sm:w-auto gap-2"
                      size="lg"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Back to Content
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Paper Content with Swipe Animation */
              <div className="relative h-full overflow-x-hidden !outline-none" data-content-scroll tabIndex={0} >
                {isMobile ? (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentIndex}
                      initial={{
                        x: swipeDirection === 'left' ? 300 : swipeDirection === 'right' ? -300 : 0,
                        opacity: 0
                      }}
                      animate={{
                        x: 0,
                        opacity: 1
                      }}
                      exit={{
                        x: swipeDirection === 'left' ? -300 : swipeDirection === 'right' ? 300 : 0,
                        opacity: 0
                      }}
                      transition={{
                        type: "tween",
                        duration: 0.15,
                        ease: "easeOut"
                      }}
                      onAnimationComplete={() => setSwipeDirection(null)}
                      drag="x"
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.1}
                      onDragEnd={handleDragEnd}
                      className="h-full cursor-grab active:cursor-grabbing"
                      style={{ touchAction: 'pan-y' }}
                    >
                      <PaperContent key={currentIndex} paper={currentPaper} />
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  /* Desktop - No Animation */
                  <div className="h-full">
                    <PaperContent key={currentIndex} paper={currentPaper} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
} 