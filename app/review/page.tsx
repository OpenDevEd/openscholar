"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { getReviewsForList, createReviewQuick, ReviewListItem } from "../actions/review";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, FileText, Calendar, BarChart3, Clock, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

function ReviewList() {
  const [reviews, setReviews] = useState<ReviewListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [newReviewTitle, setNewReviewTitle] = useState("");
  const [newReviewDescription, setNewReviewDescription] = useState("");

  useEffect(() => {
    loadReviews();
  }, []);

  const loadReviews = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const reviewData = await getReviewsForList();
      setReviews(reviewData);
    } catch (err) {
      console.error("Failed to load reviews:", err);
      setError("Failed to load reviews. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateReview = async () => {
    if (!newReviewTitle.trim()) return;

    try {
      setIsCreating(true);
      const newReview = await createReviewQuick({
        title: newReviewTitle.trim(),
        description: newReviewDescription.trim() || undefined,
      });

      // Redirect to the new review
      window.location.href = `/review/${newReview.id}`;
    } catch (err) {
      console.error("Failed to create review:", err);
      setError("Failed to create review. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const filteredReviews = reviews.filter(review =>
    review.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    review.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400';
    }
  };

  const getStepLabel = (step: string | null) => {
    if (!step) return "Not Started";

    const labels: Record<string, string> = {
      research_question: "Research Question",
      search_terms: "Search Terms",
      screening_questions: "Screening Questions",
      data_extraction_questions: "Data Extraction Questions",
      search_execution: "Systematic Review Process"
    };
    return labels[step] || step.replace('_', ' ').toUpperCase();
  };

  if (isLoading) {
    return (
      <motion.div
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
          style={{ transformOrigin: 'center center', willChange: 'transform' }}
        >
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center justify-center p-8">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                style={{ willChange: 'transform' }}
              >
                <Loader2 className="h-8 w-8 mb-4 text-primary" />
              </motion.div>
              <motion.h3
                className="text-lg font-semibold mb-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.2 }}
              >
                Loading Reviews
              </motion.h3>
              <motion.p
                className="text-sm text-muted-foreground text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.3 }}
              >
                Please wait while we load your systematic reviews...
              </motion.p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="main-content"
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
      >
        <motion.div
          className="container max-w-6xl mx-auto px-4 py-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        >
        {/* Header */}
        <motion.div
          className="flex items-center justify-between mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
        >
          <div>
            <motion.h1
              className="text-3xl font-bold tracking-tight"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              Systematic Reviews
            </motion.h1>
            <motion.p
              className="text-muted-foreground mt-2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              Manage and track your systematic review projects
            </motion.p>
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                New Review
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create New Review</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    placeholder="Enter review title..."
                    value={newReviewTitle}
                    onChange={(e) => setNewReviewTitle(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description (Optional)</label>
                  <Textarea
                    placeholder="Brief description of your review..."
                    value={newReviewDescription}
                    onChange={(e) => setNewReviewDescription(e.target.value)}
                    className="mt-1"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreateReview}
                  disabled={!newReviewTitle.trim() || isCreating}
                  className="w-full"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Review
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </motion.div>

        {/* Search */}
        <motion.div
          className="relative mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.5, ease: "easeOut" }}
        >
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search reviews..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </motion.div>

        {/* Error */}
        {error && (
          <Alert className="mb-6 border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Reviews Grid */}
        {filteredReviews.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No reviews found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? "Try adjusting your search terms." : "Create your first systematic review to get started."}
            </p>
            {!searchTerm && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Create Your First Review
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create New Review</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Title</label>
                      <Input
                        placeholder="Enter review title..."
                        value={newReviewTitle}
                        onChange={(e) => setNewReviewTitle(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Description (Optional)</label>
                      <Textarea
                        placeholder="Brief description of your review..."
                        value={newReviewDescription}
                        onChange={(e) => setNewReviewDescription(e.target.value)}
                        className="mt-1"
                        rows={3}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleCreateReview}
                      disabled={!newReviewTitle.trim() || isCreating}
                      className="w-full"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Create Review
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: {
                  staggerChildren: 0.1,
                  delayChildren: 0.2
                }
              }
            }}
          >
            {filteredReviews.map((review, index) => (
              <motion.div
                key={review.id}
                variants={{
                  hidden: { opacity: 0, y: 20, scale: 0.95 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    scale: 1,
                    transition: {
                      duration: 0.4,
                      ease: "easeOut",
                      delay: index * 0.05
                    }
                  }
                }}
              >
                <Link href={`/review/${review.id}`}>
                  <Card className="h-full hover:shadow-lg transition-all duration-300 cursor-pointer hover:scale-[1.02]">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg leading-tight">
                          {review.title || "Untitled Review"}
                        </CardTitle>
                        {review.description && (
                          <CardDescription className="mt-1 line-clamp-2">
                            {review.description}
                          </CardDescription>
                        )}
                      </div>
                      <Badge className={`ml-2 ${getStatusColor(review.status)}`}>
                        {(review.status || 'draft').replace('_', ' ')}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Progress */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium">{review.progress || 0}%</span>
                      </div>
                      <Progress value={review.progress || 0} className="h-2" />
                    </div>

                    {/* Current Step */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span>{getStepLabel(review.currentStep)}</span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-lg font-semibold text-blue-600">
                          {review.searchResultsCount || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Search</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-green-600">
                          {review.screeningResultsCount || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Screened</div>
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-purple-600">
                          {review.dataExtractionResultsCount || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Extracted</div>
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground w-full">
                      <Calendar className="h-3 w-3" />
                      <span>Updated {review.updatedAt ? format(review.updatedAt, "MMM d, yyyy") : "Unknown"}</span>
                    </div>
                  </CardFooter>
                </Card>
              </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense fallback={
      <motion.div
        className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: 'center center', willChange: 'transform' }}
          >
          <Card className="w-full max-w-md">
            <CardContent className="flex flex-col items-center justify-center p-8">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                style={{ willChange: 'transform' }}
              >
                <Loader2 className="h-8 w-8 mb-4 text-primary" />
              </motion.div>
              <motion.h3
                className="text-lg font-semibold mb-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                Loading
              </motion.h3>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    }>
      <ReviewList />
    </Suspense>
  );
}

/*
Original code commented out for reference:

export default function ReviewPage() {
  const { step, nextStep, previousStep } = useReviewStore();
  const [researchQuestion, setResearchQuestion] = useState("");

  const handleContinueFromStep1 = () => {
    if (researchQuestion.trim()) {
      nextStep();
    }
  };

  const handleContinueFromStep2 = () => {
    nextStep();
  };

  const handleContinueFromStep3 = () => {
    nextStep();
  };

  const handleContinueFromStep4 = () => {
    // Complete the setup - could redirect to screening or show completion
    console.log("Setup completed!");
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <Step1
            researchQuestion={researchQuestion}
            onContinue={handleContinueFromStep1}
          />
        );

      case 2:
        return (
          <Step2
            researchQuestion={researchQuestion}
            onContinue={handleContinueFromStep2}
            onBack={previousStep}
          />
        );

      case 3:
        return (
          <Step3
            researchQuestion={researchQuestion}
            onContinue={handleContinueFromStep3}
            onBack={previousStep}
          />
        );

      case 4:
        return (
          <Step4
            researchQuestion={researchQuestion}
            onContinue={handleContinueFromStep4}
            onBack={previousStep}
          />
        );

      default:
        return (
          <motion.main
            key={`step-${step}`}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="w-full min-h-screen bg-background flex items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <Card className="max-w-md mx-auto text-center">
                <CardHeader>
                  <CardTitle>Step {step}</CardTitle>
                  <CardDescription>This step is coming soon...</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">Working on step {step} implementation.</p>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="outline" onClick={previousStep}>
                    Back to Step {step - 1}
                  </Button>
                  <Button disabled>Coming Soon</Button>
                </CardFooter>
              </Card>
            </motion.div>
          </motion.main>
        );
    }
  };

  return (
    <AnimatePresence mode="popLayout">
      {renderStep()}
    </AnimatePresence>
  );
}
*/
