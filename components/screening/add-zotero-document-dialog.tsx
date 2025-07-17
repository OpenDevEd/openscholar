"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useScreeningStore, ScreeningDocument } from '@/lib/store';
import { useZoteroConfigStore } from '@/lib/store';
import { Loader2, Plus, Key, Hash, FileText } from 'lucide-react';
import { getZoteroFileUrl } from '@/app/actions/zotero';
import { buildZoteroHeaders } from '@/lib/zotero-utils';

interface AddZoteroDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddZoteroDocumentDialog({ open, onOpenChange }: AddZoteroDocumentDialogProps) {
  const { addDocument } = useScreeningStore();
  const { zoteroApiKey, zoteroGroupId, setZoteroApiKey, setZoteroGroupId } = useZoteroConfigStore();

  const [inputIds, setInputIds] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleSubmit = async () => {
    const ids = inputIds
      .split(/\n|,|;/)
      .map((id) => id.trim())
      .filter(Boolean);

    if (!zoteroApiKey.trim() || !zoteroGroupId.trim()) {
      toast.error('Zotero API Key and Group ID are required');
      return;
    }

    if (ids.length === 0) {
      toast.error('Please enter at least one Zotero item key');
      return;
    }

    setIsAdding(true);
    try {
      const added: number[] = [];
      for (const id of ids) {
        try {
          const item = await fetchZoteroItem(zoteroApiKey.trim(), zoteroGroupId.trim(), id);
          if (!item) {
            toast.warning(`Item ${id} not found or inaccessible`);
            continue;
          }
          const doc = await mapZoteroItemToScreeningDocument(item, zoteroApiKey.trim(), zoteroGroupId.trim());
          addDocument(doc);
          added.push(1);
        } catch (err: any) {
          console.error(err);
          toast.error(`Failed to import ${id}`);
        }
      }

      if (added.length > 0) {
        toast.success(`Imported ${added.length} document(s) from Zotero`);
        setInputIds('');
        onOpenChange(false);
      }
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" /> Add Zotero Documents
          </DialogTitle>
          <DialogDescription>Import items from your Zotero group library</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Key className="h-4 w-4" /> Zotero Configuration
              </CardTitle>
              <CardDescription className="text-xs">Stored locally for future use</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="zotero-api-key">API Key</Label>
                <Input
                  id="zotero-api-key"
                  type="password"
                  value={zoteroApiKey}
                  onChange={(e) => setZoteroApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zotero-group-id">Group ID</Label>
                <Input
                  id="zotero-group-id"
                  value={zoteroGroupId}
                  onChange={(e) => setZoteroGroupId(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* IDs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Hash className="h-4 w-4" /> Item Keys / URLs
              </CardTitle>
              <CardDescription className="text-xs">Enter Zotero item keys or links, one per line</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="e.g. ABCDEF, https://www.zotero.org/groups/123/items/ABCDEF"
                value={inputIds}
                onChange={(e) => setInputIds(e.target.value)}
                rows={5}
                className="max-h-64 overflow-y-auto resize-y"
              />
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isAdding}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isAdding}>
            {isAdding ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Importing...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" />Add Documents
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------ Helper functions ------------------

async function fetchZoteroItem(apiKey: string, groupId: string, itemIdOrUrl: string) {
  const cleanId = itemIdOrUrl.trim().split('/').pop();
  if (!cleanId) return null;
  const headers = {
    ...buildZoteroHeaders(apiKey),
    'Content-Type': 'application/json',
  };
  const itemRes = await fetch(`https://api.zotero.org/groups/${groupId}/items/${cleanId}`, { headers });
  if (!itemRes.ok) return null;
  const item = await itemRes.json();

  // Fetch attachments
  const attachRes = await fetch(`https://api.zotero.org/groups/${groupId}/items/${cleanId}/children?itemType=attachment`, { headers });
  const attachments = attachRes.ok ? await attachRes.json() : [];
  return { item, attachments };
}

async function mapZoteroItemToScreeningDocument(data: any, apiKey: string, groupId: string): Promise<ScreeningDocument> {
  const { item, attachments } = data;
  const creators = item.data.creators || [];
  const authorships = creators.map((c: any) => ({
    author: { display_name: c.lastName ? `${c.firstName || ''} ${c.lastName}`.trim() : c.name }
  }));

  // Find PDF attachment URL (don't download, just get the URL)
  let pdfUrl: string | undefined = undefined;
  if (attachments && attachments.length) {
    const pdfAttachments = attachments.filter((a: any) => a.data.contentType === 'application/pdf');
    const publishTagged = pdfAttachments.find((a: any) => a.data.tags?.some((t: any) => t.tag === '_publish'));
    const chosen = publishTagged || pdfAttachments[0];
    if (chosen) {
      if (chosen.data.linkMode === 'linked_file' && chosen.data.url) {
        // Publicly accessible link
        pdfUrl = chosen.data.url;
      } else {
        pdfUrl = chosen.data.url || chosen.links?.enclosure?.href;
      }
      if (!pdfUrl) {
        // Try to get the Zotero file URL
        const directUrl = await getZoteroFileUrl({ groupId, childKey: chosen.key, apiKey });
        if (directUrl) {
          pdfUrl = directUrl;
        }
      }
      console.log(`Found PDF URL for Zotero item ${chosen.key}: ${pdfUrl}`);
    }
  }

  const yearMatch = /\d{4}/.exec(item.data.date || '');
  const pubYear = yearMatch ? parseInt(yearMatch[0]) : undefined;

  return {
    id: `zotero_${item.key}`,
    title: item.data.title,
    publication_year: pubYear,
    abstract: item.data.abstractNote,
    doi: item.data.DOI,
    authorships,
    open_access: pdfUrl ? { is_oa: true, oa_url: pdfUrl } : undefined,
    zotero_group_id: groupId,
    zotero_uri: `https://ref.opendeved.net/g/${groupId}/${item.key}|/?openin=zoteroapp`,
    addedAt: new Date().toISOString(),
    originalWork: item,
    source: 'zotero',
  };
} 