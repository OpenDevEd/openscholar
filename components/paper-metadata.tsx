import React from 'react';
import { Users, Quote, TrendingUp, BookOpen, BarChart3, Award, Target, Layers, Building, Leaf, Unlock, Lock, Globe } from 'lucide-react';

interface PaperMetadataProps {
  result: any;
  isExpanded?: boolean;
}

export function PaperMetadata({ result, isExpanded = false }: PaperMetadataProps) {
  if (!isExpanded) return null;

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      {/* Authors */}
      {result.authorships && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4 flex-shrink-0" />
          <span>{result.authorships
            .map((author: { author: { display_name: string } }) => author.author.display_name)
            .join(', ')}</span>
        </div>
      )}

      {/* Citation Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Quote className="h-3 w-3" />
          <span className="font-medium">Cites:</span>
          <span>{result.referenced_works_count || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          <span className="font-medium">Cited by:</span>
          <span>{result.cited_by_count || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <BookOpen className="h-3 w-3" />
          <span className="font-medium">Related:</span>
          <span>{result.related_works?.length || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <BarChart3 className="h-3 w-3" />
          <span className="font-medium">FWCI:</span>
          <span>{result.fwci ? result.fwci.toFixed(2) : 'N/A'}</span>
        </div>
      </div>

      {/* Percentiles */}
      {result.cited_by_percentile_year && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Award className="h-3 w-3" />
            <span className="font-medium">Citation Percentile (Year):</span>
            <span>{result.cited_by_percentile_year.min}-{result.cited_by_percentile_year.max}%</span>
          </div>
        </div>
      )}

      {/* Academic Classification */}
      <div className="space-y-2">
        {result.primary_topic && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Target className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-medium">Topic:</span>
              <span className="ml-1">{result.primary_topic.display_name}</span>
            </div>
          </div>
        )}
        
        {result.primary_topic?.subfield && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Layers className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-medium">Subfield:</span>
              <span className="ml-1">{result.primary_topic.subfield.display_name}</span>
            </div>
          </div>
        )}
        
        {result.primary_topic?.field && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <BookOpen className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-medium">Field:</span>
              <span className="ml-1">{result.primary_topic.field.display_name}</span>
            </div>
          </div>
        )}
        
        {result.primary_topic?.domain && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Building className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-medium">Domain:</span>
              <span className="ml-1">{result.primary_topic.domain.display_name}</span>
            </div>
          </div>
        )}
        
        {result.sustainable_development_goals && result.sustainable_development_goals.length > 0 && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <Leaf className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="font-medium">SDGs:</span>
              <div className="ml-1 flex flex-wrap gap-1 mt-1">
                {result.sustainable_development_goals.map((sdg: { id: string; display_name: string; score: number }) => (
                  <span 
                    key={sdg.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs"
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
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Open Access Status */}
      {result.open_access && (
        <div className="flex items-center gap-2 text-xs">
          {result.open_access.is_oa ? (
            <div className="flex items-center gap-1 text-green-600">
              <Unlock className="h-3 w-3" />
              <span className="font-medium">Open Access</span>
              {result.open_access.oa_type && (
                <span className="text-muted-foreground">({result.open_access.oa_type})</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span className="font-medium">Closed Access</span>
            </div>
          )}
          {result.open_access.oa_url && (
            <a 
              href={result.open_access.oa_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-blue-600 hover:underline"
            >
              <Globe className="h-3 w-3" />
              <span>View PDF</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
} 