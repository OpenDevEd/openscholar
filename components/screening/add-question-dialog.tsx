"use client";

import React, { useState } from 'react';
import { useScreeningStore, type ScreeningQuestionType } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

interface AddQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question?: {
    id: string;
    key: string;
    type: ScreeningQuestionType;
    question: string;
  } | null;
}

export function AddQuestionDialog({ open, onOpenChange, question }: AddQuestionDialogProps) {
  const { addQuestion, updateQuestion, questions } = useScreeningStore();
  const isEditMode = !!question;

  const [formData, setFormData] = useState({
    key: question?.key ?? '',
    type: (question?.type as ScreeningQuestionType | '') ?? '',
    question: question?.question ?? '',
  });

  // When the dialog opens with a different question, sync state
  React.useEffect(() => {
    if (isEditMode) {
      setFormData({ key: question!.key, type: question!.type, question: question!.question });
    } else {
      setFormData({ key: '', type: '', question: '' });
    }
  }, [isEditMode, question]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.key.trim()) {
      toast.error('Key is required');
      return;
    }
    
    if (!formData.type) {
      toast.error('Type is required');
      return;
    }
    
    if (!formData.question.trim()) {
      toast.error('Question is required');
      return;
    }

    const existingKeys = questions.map((q: any) => q.key.toLowerCase());

    if (!/^[a-zA-Z0-9_]+$/.test(formData.key)) {
      toast.error('Key must contain only letters, numbers, and underscores');
      return;
    }

    if (!isEditMode && existingKeys.includes(formData.key.toLowerCase())) {
      toast.error('A question with this key already exists');
      return;
    }

    if (isEditMode && formData.key.toLowerCase() !== question!.key.toLowerCase() && existingKeys.includes(formData.key.toLowerCase())) {
      toast.error('Another question already uses this key');
      return;
    }

    if (isEditMode) {
      updateQuestion(question!.id, {
        key: formData.key.trim(),
        type: formData.type as ScreeningQuestionType,
        question: formData.question.trim(),
      });
      toast.success('Question updated');
    } else {
      addQuestion({
        key: formData.key.trim(),
        type: formData.type as ScreeningQuestionType,
        question: formData.question.trim(),
      });
      toast.success('Question added');
    }
    
    // Reset form
    setFormData({
      key: '',
      type: '',
      question: '',
    });
    
    onOpenChange(false);
  };

  const handleCancel = () => {
    setFormData({
      key: '',
      type: '',
      question: '',
    });
    onOpenChange(false);
  };

  const handleQuestionChange = (value: string) => {
    setFormData(prev => ({ ...prev, question: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Screening Question' : 'Add Screening Question'}</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Update the selected question.' : 'Create a new question for systematic document screening.'}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="question">Question *</Label>
            <Textarea
              id="question"
              value={formData.question}
              onChange={(e) => handleQuestionChange(e.target.value)}
              placeholder="e.g., Is this study relevant to our research question?"
              rows={3}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="key">Key *</Label>
            <Input
              id="key"
              value={formData.key}
              onChange={(e) => setFormData(prev => ({ ...prev, key: e.target.value }))}
              placeholder="e.g., relevance_check"
              required
              disabled={isEditMode} // don't allow changing key in edit mode
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this question. Use letters, numbers, and underscores only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Answer Type *</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData(prev => ({ ...prev, type: value as ScreeningQuestionType }))}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select answer type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boolean">Boolean (Yes/No, True/False)</SelectItem>
                <SelectItem value="string">String (Text response)</SelectItem>
                <SelectItem value="number">Number (Numeric value)</SelectItem>
                <SelectItem value="array">Array (Multiple values)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {formData.type === 'boolean' && 'Screeners will answer with true/false or yes/no.'}
              {formData.type === 'string' && 'Screeners will provide a text response.'}
              {formData.type === 'number' && 'Screeners will provide a numeric value.'}
              {formData.type === 'array' && 'Screeners can provide multiple values.'}
              {!formData.type && 'Choose the type of answer expected for this question.'}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit">
              {isEditMode ? 'Save Changes' : 'Add Question'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
} 