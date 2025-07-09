"use client";

import React, { useState } from 'react';
import { useScreeningStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { toast } from 'sonner';

interface AddDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddDocumentDialog({ open, onOpenChange }: AddDocumentDialogProps) {
  const { addDocument } = useScreeningStore();
  const [formData, setFormData] = useState({
    title: '',
    authors: '',
    publication_year: '',
    abstract: '',
    doi: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }

    addDocument({
      id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: formData.title.trim(),
      publication_year: formData.publication_year ? parseInt(formData.publication_year) : undefined,
      abstract: formData.abstract.trim() || undefined,
      doi: formData.doi.trim() || undefined,
      authorships: formData.authors.trim() ? [{
        author: { display_name: formData.authors.trim() }
      }] : undefined,
    });

    toast.success('Document added successfully');
    
    // Reset form
    setFormData({
      title: '',
      authors: '',
      publication_year: '',
      abstract: '',
      doi: '',
    });
    
    onOpenChange(false);
  };

  const handleCancel = () => {
    setFormData({
      title: '',
      authors: '',
      publication_year: '',
      abstract: '',
      doi: '',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Document</DialogTitle>
          <DialogDescription>
            Add a document to your screening list. Only the title is required.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter the document title"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="authors">Authors</Label>
            <Input
              id="authors"
              value={formData.authors}
              onChange={(e) => setFormData(prev => ({ ...prev, authors: e.target.value }))}
              placeholder="e.g., Smith, J., Jones, A."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="year">Publication Year</Label>
            <Input
              id="publication_year"
              type="number"
              min="1900"
              max={new Date().getFullYear()}
              value={formData.publication_year}
              onChange={(e) => setFormData(prev => ({ ...prev, publication_year: e.target.value }))}
              placeholder="e.g., 2023"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="doi">DOI</Label>
            <Input
              id="doi"
              value={formData.doi}
              onChange={(e) => setFormData(prev => ({ ...prev, doi: e.target.value }))}
              placeholder="e.g., 10.1000/182"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="abstract">Abstract</Label>
            <Textarea
              id="abstract"
              value={formData.abstract}
              onChange={(e) => setFormData(prev => ({ ...prev, abstract: e.target.value }))}
              placeholder="Enter the document abstract (optional)"
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button type="submit">
              Add Document
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
} 