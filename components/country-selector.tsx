import React from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Globe, ChevronRight, Check, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { COUNTRY_HIERARCHY, COUNTRIES, getCountryCodesForRegions } from "@/lib/constants";
import { CountryFlag } from "@/components/ui/country-flag";

type RegionNode = {
  id: string;
  label: string;
  level: number;
  parentId?: string;
  children?: RegionNode[];
  isCountry?: boolean;
};

interface CountrySelectorProps {
  selectedRegions: string[];
  onSelectionChange: (regions: string[]) => void;
  placeholder?: string;
  description?: string;
  className?: string;
  triggerClassName?: string;
  showCountryNames?: boolean; // If true, returns country names instead of codes
  bypassLimit?: boolean; // If true, bypasses the 100 country limit check
}

export function CountrySelector({
  selectedRegions,
  onSelectionChange,
  placeholder = "Select countries or regions",
  description = "Choose regions or countries",
  className,
  triggerClassName,
  showCountryNames = false,
  bypassLimit = false
}: CountrySelectorProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [expandedNodes, setExpandedNodes] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState("");

  // Build the tree structure from the hierarchy
  const buildTree = React.useMemo(() => {
    function processEntry(entry: any, level: number = 0, parentId?: string): RegionNode {
      const id = entry.label.toLowerCase().replace(/\s+/g, '_');
      
      const node: RegionNode = {
        id,
        label: entry.label,
        level,
        parentId,
        children: [],
        isCountry: !entry.children || entry.children.length === 0
      };

      if (entry.children) {
        node.children = entry.children.map((child: any) => {
          // If this child has no children, it's a country code - use the code as ID
          if (!child.children || child.children.length === 0) {
            return {
              id: child.label, // Use country code directly as ID
              label: child.label,
              level: level + 1,
              parentId: id,
              children: [],
              isCountry: true
            };
          } else {
            // This is a region, process normally
            return processEntry(child, level + 1, id);
          }
        });
      }

      return node;
    }

    return processEntry(COUNTRY_HIERARCHY);
  }, []);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleSelectRegion = (regionId: string) => {
    const newRegions = selectedRegions.includes(regionId)
      ? selectedRegions.filter(r => r !== regionId)
      : [...selectedRegions, regionId];
    
    onSelectionChange(newRegions);
  };

  const handleClearFilter = () => {
    onSelectionChange([]);
  };

  const getCountryData = () => {
    return getCountryCodesForRegions(selectedRegions, bypassLimit);
  };

  const countryData = getCountryData();

  // Get display data based on mode
  const getDisplayData = () => {
    if (showCountryNames) {
      // Return country names for Country focus
      const countryNames: string[] = [];
      selectedRegions.forEach(regionId => {
        if (regionId.length === 2 && COUNTRIES[regionId]) {
          // Direct country code
          countryNames.push(COUNTRIES[regionId]);
        } else {
          // Region - get all country names from the region
          const regionCountryCodes = countryData.countries;
          regionCountryCodes.forEach(code => {
            if (COUNTRIES[code] && !countryNames.includes(COUNTRIES[code])) {
              countryNames.push(COUNTRIES[code]);
            }
          });
        }
      });
      return countryNames;
    } else {
      // Return country codes for existing filter
      return countryData.countries;
    }
  };

  const displayData = getDisplayData();

  // Filter nodes based on search query
  const filterNodes = (node: RegionNode, query: string): RegionNode | null => {
    if (!query.trim()) return node;

    const searchTerm = query.toLowerCase();
    
    // For countries, check both the country code and the full country name
    const nodeMatchesSearch = node.isCountry ? 
      (node.label.toLowerCase().includes(searchTerm) || 
       COUNTRIES[node.label]?.toLowerCase().includes(searchTerm)) :
      node.label.toLowerCase().includes(searchTerm);

    // If this node matches, return it with all its children
    if (nodeMatchesSearch) {
      return node;
    }

    // Check if any children match
    if (node.children && node.children.length > 0) {
      const filteredChildren = node.children
        .map(child => filterNodes(child, query))
        .filter(child => child !== null) as RegionNode[];

      if (filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren
        };
      }
    }

    return null;
  };

  // Get filtered tree
  const filteredTree = React.useMemo(() => {
    if (!searchQuery.trim()) return buildTree;
    return filterNodes(buildTree, searchQuery);
  }, [buildTree, searchQuery]);

  // Auto-expand nodes when searching
  React.useEffect(() => {
    if (searchQuery.trim() && filteredTree) {
      const toExpand = new Set<string>();
      
      const expandAll = (node: RegionNode) => {
        // Always expand this node if it has children
        if (node.children && node.children.length > 0) {
          toExpand.add(node.id);
        }
        
        // Recursively expand children
        if (node.children) {
          node.children.forEach(child => {
            expandAll(child);
          });
        }
      };
      
      expandAll(filteredTree);
      setExpandedNodes(toExpand);
    }
  }, [searchQuery, filteredTree]);

  const renderNode = (node: RegionNode): React.ReactNode => {
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedRegions.includes(node.id);
    const hasChildren = node.children && node.children.length > 0;
    
    // For countries (leaf nodes), show the country name from COUNTRIES mapping
    const displayName = node.isCountry && COUNTRIES[node.label] 
      ? COUNTRIES[node.label] 
      : node.label;

    return (
      <div key={node.id} className="w-full">
        <div className="flex items-center gap-2 py-1">
          <div 
            className="flex items-center gap-2 flex-1 cursor-pointer hover:bg-muted/50 rounded-md px-2 py-1"
            onClick={() => toggleNode(node.id)}
          >
            {hasChildren && (
              <ChevronRight 
                className={cn(
                  "h-4 w-4 transition-transform text-muted-foreground",
                  isExpanded && "rotate-90"
                )}
              />
            )}
            {!hasChildren && <div className="w-4" />}
            {node.isCountry ? (
              <div className="flex items-center gap-1">
                <CountryFlag countryCode={node.label} />
                <div className="h-4 text-xs flex items-center justify-center bg-blue-100 text-blue-600 rounded border px-1">
                  {node.label}
                </div>
              </div>
            ) : (
              <Globe className="h-4 w-4 text-muted-foreground" />
            )}
            <span 
              className={cn(
                "text-sm flex-1",
                node.level === 0 && "font-semibold",
                node.level === 1 && "font-medium",
                node.isCountry && "text-sm font-normal text-foreground"
              )}
            >
              {displayName}
            </span>
          </div>
          
          <Button
            variant={isSelected ? "default" : "ghost"}
            size="sm"
            className="h-7 px-2"
            onClick={() => handleSelectRegion(node.id)}
          >
            {isSelected ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Selected
              </>
            ) : (
              "Select"
            )}
          </Button>
        </div>

        {((isExpanded && hasChildren) || (searchQuery.trim() && hasChildren)) && (
          <div className="ml-4 border-l border-border/50 pl-2">
            {node.children?.map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn("space-y-3", className)}>
      <Popover open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setSearchQuery("");
        }
      }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              selectedRegions.length === 0 && "text-muted-foreground",
              countryData.isLimitExceeded && "border-orange-300 bg-orange-50",
              triggerClassName
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">
                {selectedRegions.length > 0 ? (
                  (() => {
                    const regions = selectedRegions.filter(id => !(id.length === 2 && COUNTRIES[id]));
                    const countries = selectedRegions.filter(id => id.length === 2 && COUNTRIES[id]);
                    const parts = [];
                    
                    if (regions.length > 0) {
                      parts.push(`${regions.length} region${regions.length > 1 ? 's' : ''}`);
                    }
                    if (countries.length > 0) {
                      parts.push(`${countries.length} countr${countries.length > 1 ? 'ies' : 'y'}`);
                    }
                    
                    const displayCount = showCountryNames ? displayData.length : countryData.countries.length;
                    return parts.length > 0 
                      ? `${parts.join(' + ')} (${displayCount} ${showCountryNames ? 'countries' : 'codes'} total)`
                      : "No selections";
                  })()
                ) : (
                  placeholder
                )}
              </span>
              {countryData.isLimitExceeded && (
                <span className="text-orange-500 text-xs flex-shrink-0">⚠️</span>
              )}
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="p-4 border-b border-border">
            <h4 className="font-medium">Select Regions or Countries</h4>
            <p className="text-sm text-muted-foreground mt-1">
              {description}
            </p>
            <div className="mt-3 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search countries or regions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <ScrollArea className="h-[400px]">
            <div className="p-4">
              {filteredTree && filteredTree.children ? (
                filteredTree.children.map(child => renderNode(child))
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No matches found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Selected regions display */}
      {selectedRegions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Selected {showCountryNames ? 'countries' : 'regions'}:
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedRegions.map((regionId, index) => {
              // Check if this is a country code (2 letters) or a region
              const isCountryCode = regionId.length === 2 && COUNTRIES[regionId];
              const displayLabel = isCountryCode 
                ? COUNTRIES[regionId] 
                : regionId.split('_').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                  ).join(' ');
              
              return (
                <React.Fragment key={regionId}>
                  <Badge
                    variant={isCountryCode ? "outline" : "secondary"}
                    className={cn(
                      "cursor-pointer hover:bg-destructive hover:text-destructive-foreground max-w-[200px]",
                      isCountryCode && "border-blue-300 bg-blue-50 text-blue-700"
                    )}
                    onClick={() => handleSelectRegion(regionId)}
                  >
                    {isCountryCode && (
                      <>
                        <CountryFlag countryCode={regionId} className="mr-1 flex-shrink-0" />
                        <span className="text-xs mr-1 font-mono flex-shrink-0">{regionId}</span>
                      </>
                    )}
                    <span className="truncate">
                      {displayLabel}
                    </span>
                    <X className="h-3 w-3 ml-1 flex-shrink-0" />
                  </Badge>
                  {index < selectedRegions.length - 1 && (
                    <span className="text-xs text-muted-foreground font-medium bg-muted px-2 py-1 rounded flex-shrink-0">
                      OR
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {showCountryNames 
              ? `${displayData.length} countries selected for search focus`
              : `Filtering by ${countryData.countries.length} countries total`
            }
          </p>
        </div>
      )}
    </div>
  );
} 