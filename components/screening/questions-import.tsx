"use client";

import React, { useState } from 'react';
import { useScreeningStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';

interface QuestionsImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuestionsImport({ open, onOpenChange }: QuestionsImportProps) {
  const { importQuestionsFromText } = useScreeningStore();
  const [text, setText] = useState('');
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: number;
    errors: string[];
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!text.trim()) {
      toast.error('Please enter questions to import');
      return;
    }

    const result = importQuestionsFromText(text.trim());
    setImportResult(result);

    if (result.success) {
      toast.success(`Successfully imported ${result.imported} questions`);
      setText('');
      setTimeout(() => {
        onOpenChange(false);
        setImportResult(null);
      }, 2000);
    } else {
      toast.error(`Import failed with ${result.errors.length} errors`);
    }
  };

  const handleCancel = () => {
    setText('');
    setImportResult(null);
    onOpenChange(false);
  };

  const exampleText = `relevance|boolean|Is this study relevant to our research question?
methodology|string|What methodology was used in this study?
sample_size|number|What is the sample size of this study?
keywords|array|What are the key terms mentioned in this paper?`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Import Questions</DialogTitle>
          <DialogDescription>
            Import multiple questions using the format: key|type|question (one per line)
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p><strong>Format:</strong> Each line should follow the pattern: <code>key|type|question</code></p>
                <p><strong>Types:</strong> boolean, string, number, array</p>
                <p><strong>Example:</strong></p>
                <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto whitespace-pre-wrap break-words">
{exampleText}
                </pre>
              </div>
            </AlertDescription>
          </Alert>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="questions-text">Questions Text</Label>
              <Textarea
                id="questions-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={exampleText}
                rows={10}
                className="font-mono text-sm resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Paste your questions here, one per line in the format: key|type|question
              </p>
            </div>

            {importResult && (
              <Alert
                className={importResult.success
                  ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
                  : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/40"}
              >
                {importResult.success ? (
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                )}
                <AlertDescription>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={importResult.success ? "default" : "destructive"}>
                        {importResult.success ? 'Success' : 'Failed'}
                      </Badge>
                      <span className="text-sm">
                        {importResult.imported} questions imported
                      </span>
                    </div>
                    
                    {importResult.errors.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-red-800 dark:text-red-300">Errors:</p>
                        <ul className="text-xs space-y-1">
                          {importResult.errors.map((error, index) => (
                            <li key={index} className="text-red-700 dark:text-red-400">• {error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={!text.trim()}>
                Import Questions
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
} 