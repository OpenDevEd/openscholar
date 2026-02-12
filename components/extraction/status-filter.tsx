"use client";

import {
  Filter,
  FileText,
  Unlock,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslations } from "next-intl";

interface StatusFilterProps {
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

const options = [
  { id: 'has-pdf', label: 'Has PDF', icon: FileText },
  { id: 'abstract-only', label: 'Abstract Only', icon: FileText },
  { id: 'open-access', label: 'Open Access', icon: Unlock },
  { id: 'has-errors', label: 'Has Errors', icon: AlertCircle },
  { id: 'high-confidence', label: 'High Confidence', icon: TrendingUp },
  { id: 'low-confidence', label: 'Low Confidence', icon: TrendingDown },
  { id: 'reviewed', label: 'Reviewed', icon: CheckCircle2 },
  { id: 'needs-followup', label: 'Needs Follow-up', icon: AlertTriangle },
];

export function StatusFilter({ selected, onChange }: StatusFilterProps) {
  const t = useTranslations('filters');
  const toggleStatus = (id: string) => {
    const newSet = new Set(selected);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    onChange(newSet);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="w-4 h-4 mr-2" />
          Status
          {selected.size > 0 && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
              {selected.size}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="space-y-2">
          <Label>{t('filterByStatus')}</Label>
          {options.map(option => {
            const Icon = option.icon;
            return (
              <div key={option.id} className="flex items-center gap-2">
                <Checkbox
                  checked={selected.has(option.id)}
                  onCheckedChange={() => toggleStatus(option.id)}
                  id={option.id}
                />
                <Icon className="w-4 h-4 text-muted-foreground" />
                <label
                  htmlFor={option.id}
                  className="text-sm cursor-pointer flex-1"
                >
                  {option.label}
                </label>
              </div>
            );
          })}
          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(new Set())}
              className="w-full mt-2"
            >
              Clear All
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
