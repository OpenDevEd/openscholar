"use client";

import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Code, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from 'sonner';

interface ApiButtonProps {
  apiUrl: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "icon" | "lg" | "default";
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
}

export function ApiButton({ 
  apiUrl, 
  disabled = false, 
  className,
  size = "icon",
  variant = "outline"
}: ApiButtonProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const handleCopy = async () => {
    if (!apiUrl) return;
    
    try {
      await navigator.clipboard.writeText(apiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('API URL copied', {
        description: 'The API URL has been copied to your clipboard.'
      });
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Copy failed', {
        description: 'Could not copy the API URL to clipboard.'
      });
    }
  };

  const isButtonDisabled = disabled || !apiUrl;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button 
              disabled={isButtonDisabled} 
              className={cn("flex-shrink-0", className)}
              size={size}
              variant={variant}
            >
              <Code className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          <p>View API URL</p>
        </TooltipContent>
      </Tooltip>
      
      <PopoverContent className="w-96 p-4" align="end">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Code className="h-4 w-4 text-blue-600" />
            <h4 className="font-medium text-sm">OpenAlex API URL</h4>
          </div>
          
          <p className="text-xs text-muted-foreground">
            This is the direct API endpoint used for your current search query.
          </p>
          
          <div className="relative">
            <div className="bg-muted p-3 rounded-lg text-xs font-mono break-all max-h-32 overflow-y-auto">
              {apiUrl || 'No API URL available'}
            </div>
          </div>
          
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Use this URL to access the raw API data
            </p>
            <Button
              size="sm"
              onClick={handleCopy}
              className="h-7"
              disabled={!apiUrl}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  Copy URL
                </>
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
} 