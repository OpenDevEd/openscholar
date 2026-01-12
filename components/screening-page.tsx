"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AIConfig } from '@/components/ai-config';
import { useScreeningStore, useAIConfigStore } from '@/lib/store';
import { ClipboardCheck, Plus, FileText, HelpCircle, Upload, Trash2, Settings, Brain } from 'lucide-react';
import { DocumentsList } from '@/components/screening/documents-list';
import { QuestionsList } from '@/components/screening/questions-list';
import { QuestionsImport } from '@/components/screening/questions-import';
import { AddQuestionDialog } from '@/components/screening/add-question-dialog';
import { AddDocumentDialog } from '@/components/screening/add-document-dialog';
import { AIScreeningDialog } from '@/components/screening/ai-screening-dialog';
import { AddZoteroDocumentDialog } from '@/components/screening/add-zotero-document-dialog';

interface ScreeningPageProps {
  showBackButton?: boolean;
  onBack?: () => void;
  searchId?: string;
}

export function ScreeningPage({ 
  showBackButton = false, 
  onBack,
  searchId
}: ScreeningPageProps) {
  const router = useRouter();
  const { 
    documents, 
    questions, 
    results,
    clearDocuments,
    clearQuestions
  } = useScreeningStore();

  const { dollarsUsed } = useAIConfigStore();

  const [showAddQuestion, setShowAddQuestion] = useState(false);
  const [showAddDocument, setShowAddDocument] = useState(false);
  const [showAddZotero, setShowAddZotero] = useState(false);
  const [showImportQuestions, setShowImportQuestions] = useState(false);
  const [showAIScreening, setShowAIScreening] = useState(false);
  const [activeTab, setActiveTab] = useState('documents');

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.push('/');
    }
  };

  // Manual screening handler removed

  const handleViewResults = () => {
    router.push(searchId ? `/results/${searchId}/screening/results` : '/screening/results');
  };

  const completedResults = results.filter(r => r.status === 'completed').length;
  const inProgressResults = results.filter(r => r.status === 'in_progress').length;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="container mx-auto p-6">
        <PageHeader
        title="Document Screening"
        description="Systematically review and evaluate documents using custom screening criteria"
        icon={ClipboardCheck}
        showBackButton={showBackButton}
        onBack={handleBack}
        infoItems={[
          { label: `${documents.length} documents ready for screening`, color: 'bg-blue-500' },
          { label: `${questions.length} screening questions configured`, color: 'bg-green-500' },
          { label: `${completedResults} completed, ${inProgressResults} in progress`, color: 'bg-purple-500' },
          { label: `$${dollarsUsed.toFixed(2)} spent`, color: 'bg-yellow-500' },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="documents" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3 py-2 min-w-0">
            <FileText className="h-4 w-4 flex-shrink-0" />
            <span className="truncate hidden sm:inline">Documents</span>
            <span className="truncate sm:hidden">Docs</span>
            <Badge variant="secondary" className="ml-1 text-xs flex-shrink-0">{documents.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="questions" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3 py-2 min-w-0">
            <HelpCircle className="h-4 w-4 flex-shrink-0" />
            <span className="truncate hidden sm:inline">Questions</span>
            <span className="truncate sm:hidden">Q&A</span>
            <Badge variant="secondary" className="ml-1 text-xs flex-shrink-0">{questions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="ai-config" className="flex items-center justify-center gap-1 sm:gap-2 text-xs sm:text-sm px-1 sm:px-3 py-2 min-w-0">
            <Brain className="h-4 w-4 flex-shrink-0" />
            <span className="truncate hidden sm:inline">AI Config</span>
            <span className="truncate sm:hidden">AI</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Documents
                    <Badge variant="secondary">{documents.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Manage the documents you want to screen
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddDocument(true)}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Document
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddZotero(true)}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Zotero Import
                  </Button>
                  {documents.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearDocuments}
                      className="flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear All
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DocumentsList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="questions" className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <HelpCircle className="h-5 w-5" />
                    Screening Questions
                    <Badge variant="secondary">{questions.length}</Badge>
                  </CardTitle>
                  <CardDescription>
                    Configure the questions for systematic screening
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddQuestion(true)}
                    className="flex-shrink-0"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowImportQuestions(true)}
                    className="flex-shrink-0"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </Button>
                  {questions.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearQuestions}
                      className="flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear All
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <QuestionsList />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-config" className="mt-6">
          <AIConfig />
        </TabsContent>
      </Tabs>

      {/* Action Section */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Screening Actions
            </CardTitle>
            <CardDescription>
              Start the screening process or view existing results
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                onClick={() => setShowAIScreening(true)}
                disabled={documents.length === 0 || questions.length === 0}
                className="sm:flex-1 text-white bg-gradient-to-r from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700"
              >
                <Brain className="h-4 w-4 mr-2" />
                AI Screening
              </Button>
              
              {/* Manual screening and reset buttons removed */}
              
              {results.length > 0 && (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={handleViewResults}
                  className="sm:flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Results ({completedResults}/{documents.length})
                </Button>
              )}
              
            </div>

            {(documents.length === 0 || questions.length === 0) && (
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {documents.length === 0 && questions.length === 0 
                    ? 'Please add documents and questions before starting screening.'
                    : documents.length === 0 
                    ? 'Please add at least one document before starting screening.'
                    : 'Please add at least one question before starting screening.'
                  }
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Dialogs */}
      <AddDocumentDialog 
        open={showAddDocument} 
        onOpenChange={setShowAddDocument} 
      />
      <AddQuestionDialog 
        open={showAddQuestion} 
        onOpenChange={setShowAddQuestion} 
      />
      <QuestionsImport 
        open={showImportQuestions} 
        onOpenChange={setShowImportQuestions} 
      />
      <AIScreeningDialog 
        open={showAIScreening} 
        onOpenChange={setShowAIScreening} 
      />
      <AddZoteroDocumentDialog
        open={showAddZotero}
        onOpenChange={setShowAddZotero}
      />
      </div>
    </div>
  );
} 