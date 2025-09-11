"use client"

import React, { useMemo, useState } from 'react'
import { type ColumnDef } from "@tanstack/react-table"
import { Maximize2, ArrowUpDown, Text } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { type ScreeningQuestion, useScreeningStore, useAIConfigStore } from '@/lib/store'
import { performScreening } from '@/app/actions/screening'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { AIScreeningDialog } from './ai-screening-dialog'
import { generateScreeningCsv } from '@/lib/screening-utils'

// Dice UI components
import { DataTable } from "@/components/data-table/data-table"
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { DataTableActionBar } from "@/components/data-table/data-table-action-bar"
import { useDataTable } from "@/hooks/use-data-table";
import { parseAsString, useQueryState } from 'nuqs'

interface ScreeningDataTableProps {
  data: any[]
  questions: ScreeningQuestion[]
}

const TruncatedTextWithPopover = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false)
  
  if (!text) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div 
          className="cursor-pointer hover:text-blue-600 truncate max-w-[200px]"
          onClick={() => setOpen(true)}
          title="Click to view full text"
        >
          {text}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-sm max-h-96 overflow-y-auto overflow-x-hidden">
        <div className="text-sm whitespace-pre-wrap break-words">
          {text}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case 'completed':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Completed</Badge>
    case 'in_progress':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">In Progress</Badge>
    case 'pending':
      return <Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200">Pending</Badge>
    case 'error':
      return <Badge className="bg-red-100 text-red-800 hover:bg-red-200">Error</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

const getPdfStatusBadge = (pdfStatus: string, message?: string) => {
  const badge = (() => {
    switch (pdfStatus) {
      case 'used':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">PDF Used</Badge>
      case 'metadata':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200">Metadata</Badge>
      case 'error':
        return <Badge className="bg-red-100 text-red-800 hover:bg-red-200 cursor-help">PDF Error</Badge>
      default:
        return <Badge variant="outline">{pdfStatus}</Badge>
    }
  })();

  if (pdfStatus === 'error' && message) {
    return (
      <Popover>
        <PopoverTrigger asChild>{badge}</PopoverTrigger>
        <PopoverContent className="max-w-sm text-sm">
          <p className="font-medium mb-1 text-red-700">PDF Error</p>
          <p className="whitespace-pre-wrap break-words">{message}</p>
        </PopoverContent>
      </Popover>
    );
  }
  return badge;
}

const formatCellValue = (value: any, question?: ScreeningQuestion) => {
  if (value === '' || value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>
  }

  if (question?.type === 'boolean') {
    return value === true || value === 'true' || value === 'yes' ? 
      <Badge className="bg-green-100 text-green-800 hover:bg-green-200">Yes</Badge> : 
      <Badge className="bg-red-100 text-red-800 hover:bg-red-200">No</Badge>
  }

  if (question?.type === 'array') {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return <span className="text-muted-foreground">—</span>
      }

      return (
        <Popover>
          <PopoverTrigger asChild>
            <Badge
              variant="secondary"
              className="text-xs cursor-pointer hover:bg-secondary/80"
            >
              {value.length} item{value.length > 1 ? 's' : ''}
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-64 max-w-sm max-h-64 overflow-y-auto overflow-x-hidden">
            <ul className="text-sm list-disc pl-4 break-words">
              {value.map((item: string, idx: number) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )
    }
    // If value is not an array, fallback to truncated popover
    return <TruncatedTextWithPopover text={String(value)} />
  }

  return <TruncatedTextWithPopover text={String(value)} />
}


export function ScreeningDataTableShadcn({ data, questions }: ScreeningDataTableProps) {
  const [title] = useQueryState("title", parseAsString.withDefault(""));
  const [showRescreenDialog, setShowRescreenDialog] = React.useState(false)
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  // Access store for deleting documents
  const { removeDocument, documents, questions: storeQuestions, addAIScreeningResults } = useScreeningStore()
  const { provider, apiKey } = useAIConfigStore()

  const columns: ColumnDef<any>[] = React.useMemo(() => {
    const hasZotero = data.some((d) => d.source === 'zotero');

    const baseColumns: ColumnDef<any>[] = [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "id",
        accessorKey: "id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="ID" />
        ),
        cell: ({ row }) => {
          const id = row.getValue("id") as string;
          if (!id) return <span className="text-muted-foreground">—</span>;

          let href: string;
          let label: string;
          if (row.original.source === 'zotero' && row.original.zotero_uri) {
            href = row.original.zotero_uri;
            // Display only the Zotero item key (strip prefix 'zotero_')
            label = id.replace(/^zotero_/, '');
          } else {
            href = id.startsWith("http") ? id : `https://openalex.org/${id}`;
            label = href.split("/").pop() ?? href;
          }

          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate max-w-[200px]"
            >
              {label}
            </a>
          );
        },
        enableSorting: false,
      },
      // ----- Zotero columns immediately after ID -----
      ...(hasZotero
        ? ([
            {
              id: 'zotero_group_id',
              accessorKey: 'zotero_group_id',
              header: () => <span>Group ID</span>,
              cell: ({ row }) => (
                row.original.source === 'zotero' && row.original.zotero_group_id ? (
                  <Badge variant="outline" className="font-mono">{row.original.zotero_group_id}</Badge>
                ) : <span className="text-muted-foreground">—</span>
              ),
              enableSorting: false,
            },
            {
              id: 'zotero_uri',
              accessorKey: 'zotero_uri',
              header: () => <span>Zotero URI</span>,
              cell: ({ row }) => {
                if (row.original.source !== 'zotero' || !row.original.zotero_uri) return <span className="text-muted-foreground">—</span>;
                const uri = row.original.zotero_uri as string;
                const display = uri.length > 40 ? `${uri.slice(0, 40)}…` : uri;
                return (
                  <a
                    href={uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline truncate max-w-[250px] inline-block"
                    title={uri}
                  >
                    {display}
                  </a>
                );
              },
              enableSorting: false,
            },
          ] as ColumnDef<any>[]) : []),
      {
        accessorKey: "title",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Title" />
        ),
        cell: ({ row }) => (
          <div className="font-medium max-w-[300px]">
            <TruncatedTextWithPopover text={row.getValue("title")} />
          </div>
        ),
        meta: {
          label: "Title",
          placeholder: "Search titles...",
          variant: "text",
          icon: Text,
        },
        enableColumnFilter: true,
        id: "title",
      },
      {
        id: "abstract",
        accessorKey: "abstract",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Abstract" />
        ),
        cell: ({ row }) => {
          const abstract = row.getValue("abstract") as string
          if (!abstract) return <span className="text-muted-foreground">—</span>
          return (
            <div className="text-sm max-w-[400px]">
              <TruncatedTextWithPopover text={abstract} />
            </div>
          )
        },
      },
      {
        id: "authors",
        accessorKey: "authors",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Authors
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => {
          const authorsValue = row.getValue("authors") as any
          if (!authorsValue || (Array.isArray(authorsValue) && authorsValue.length === 0)) {
            return <span className="text-muted-foreground">—</span>
          }

          if (Array.isArray(authorsValue)) {
            // reuse array UI
            const list = authorsValue
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="text-xs cursor-pointer hover:bg-secondary/80"
                  >
                    {list.length} author{list.length > 1 ? 's' : ''}
                  </Badge>
                </PopoverTrigger>
                <PopoverContent className="w-64 max-w-sm max-h-64 overflow-y-auto overflow-x-hidden">
                  <ul className="text-sm list-disc pl-4 break-words">
                    {list.map((name: string, idx: number) => (
                      <li key={idx}>{name}</li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            )
          }

          // fallback string
          return (
            <div className="text-sm max-w-[250px]">
              <TruncatedTextWithPopover text={String(authorsValue)} />
            </div>
          )
        },
      },
      {
        id: "year",
        accessorKey: "year",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Year
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => {
          const year = row.getValue("year")
          return year && typeof year !== 'object' ? (
            <Badge variant="outline" className="font-mono">
              {String(year)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Status
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => getStatusBadge(row.getValue("status")),
      },
      {
        id: "pdfStatus",
        accessorKey: "pdfStatus",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              PDF Status
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => {
          const status = row.getValue("pdfStatus") as string;
          const msg = row.original.pdfErrorMessage as string;
          return getPdfStatusBadge(status, msg);
        },
      },
      {
        id: "aiProvider",
        accessorKey: "aiProvider",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              AI Provider
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => {
          const provider = row.getValue("aiProvider") as string
          if (!provider) return <span className="text-muted-foreground">—</span>
          return (
            <Badge variant="outline" className="text-xs font-mono">
              {provider.toUpperCase()}
            </Badge>
          )
        },
      },
      {
        id: "aiConfidence",
        accessorKey: "aiConfidence",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Confidence
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => {
          const confidence = row.getValue("aiConfidence") as number
          if (!confidence) return <span className="text-muted-foreground">—</span>
          
          const percentage = Math.round(confidence * 100)
          const colorClass = percentage >= 80 ? 'text-green-600 bg-green-50 border-green-200' : 
                           percentage >= 60 ? 'text-yellow-600 bg-yellow-50 border-yellow-200' : 
                           'text-red-600 bg-red-50 border-red-200'
          
          return (
            <Badge className={cn("text-xs font-mono", colorClass)}>
              {percentage}%
            </Badge>
          )
        },
      },
      {
        id: "aiFlags",
        accessorKey: "aiFlags",
        header: "AI Flags",
        cell: ({ row }) => {
          const flags = row.getValue("aiFlags") as string
          if (!flags) return <span className="text-muted-foreground">—</span>
          
          const flagList = flags.split(', ').filter(Boolean)
          if (flagList.length === 0) return <span className="text-muted-foreground">—</span>
          
          return (
            <Popover>
              <PopoverTrigger asChild>
                <Badge 
                  variant="secondary" 
                  className="text-xs cursor-pointer hover:bg-secondary/80"
                >
                  {flagList.length} flag{flagList.length > 1 ? 's' : ''}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-w-sm max-h-64 overflow-y-auto overflow-x-hidden">
                <ul className="text-sm list-disc pl-4 break-words">
                  {flagList.map((flag, idx) => (
                    <li key={idx}>{flag}</li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )
        },
      },
      {
        id: 'cost',
        accessorKey: 'cost',
        header: () => <span>Cost ($)</span>,
        cell: ({ row }) => {
          const val = row.getValue('cost');
          return val ? `$${Number(val).toFixed(4)}` : <span className="text-muted-foreground">—</span>;
        },
        enableSorting: true,
      },
    ]

    // Add question columns
    const questionColumns: ColumnDef<any>[] = questions.map((question) => ({
      id: question.key,
      accessorKey: question.key,
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            title={question.question} // Show full question on hover
          >
            {question.key}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        if (row.original.status === 'error') {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <div className="text-sm max-w-[150px]">
            {formatCellValue(row.getValue(question.key), question)}
          </div>
        )
      },
    }))

    return [...baseColumns, ...questionColumns]
  }, [questions, data])

  const filteredData = useMemo(() => {
    return data.filter((d) => d.title.toLowerCase().includes(title.toLowerCase()))
  }, [data, title])

  // Use Dice UI's useDataTable hook
  const { table } = useDataTable({
    data: filteredData,
    columns,
    pageCount: Math.ceil(filteredData.length / 10), // Simple page count calculation
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: 10,
      },
      sorting: [{ id: "title", desc: false }],
    },
  })

  const selectedRows = table.getFilteredSelectedRowModel().rows

  const handleDeleteSelected = () => {
    if (selectedRows.length === 0) return
    if (!confirm(`Delete ${selectedRows.length} selected document(s)? This will remove their screening results as well.`)) return
    selectedRows.forEach((row) => {
      const docId = row.original.id
      removeDocument(docId)
    })
    table.resetRowSelection()
  }

  const handleExportSelected = () => {
    if (selectedRows.length === 0) return
    const tableRows = selectedRows.map(r => r.original);
    const csvContent = generateScreeningCsv(tableRows, questions);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `screening-selected-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
  }

  const handleRescreenSelected = () => {
    if (selectedRows.length === 0) return
    if (!provider || !apiKey) {
      toast.error('AI provider and API key must be configured first')
      return
    }

    const selectedIds = selectedRows.map((r) => r.original.id)
    const docsToScreen = documents.filter((d) => selectedIds.includes(d.id))
    if (docsToScreen.length === 0) return

    setShowRescreenDialog(true)
  }

  const handleRescreenDialogClose = () => {
    setShowRescreenDialog(false)
    table.resetRowSelection()
  }

  return (
    <>
      <div className="w-full">
        <div className="flex justify-end mb-4 absolute top-4 right-4">
          <Sheet open={isFullscreen} onOpenChange={setIsFullscreen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" title="View in fullscreen">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-none p-6 overflow-hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Screening Results Fullscreen View</SheetTitle>
              </SheetHeader>
              <div className="h-full">
                <DataTable table={table}>
                  <DataTableToolbar table={table} />
                  <DataTableActionBar table={table}>
                    <Button size="sm" variant="destructive" onClick={handleDeleteSelected}>
                      Delete Selected
                    </Button>
                    <Button size="sm" variant="default" onClick={handleRescreenSelected}>
                      AI Rescreen
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleExportSelected}>
                      Export CSV
                    </Button>
                  </DataTableActionBar>
                </DataTable>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <DataTable table={table}>
          <DataTableToolbar table={table} />
          <DataTableActionBar table={table}>
            <Button size="sm" variant="destructive" onClick={handleDeleteSelected}>
              Delete Selected
            </Button>
            <Button size="sm" variant="default" onClick={handleRescreenSelected}>
              AI Rescreen
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportSelected}>
              Export CSV
            </Button>
          </DataTableActionBar>
        </DataTable>
      </div>

      {/* AI Rescreen Dialog */}
      <AIScreeningDialog
        open={showRescreenDialog}
        onOpenChange={handleRescreenDialogClose}
        documentsToScreen={selectedRows.length > 0 ? documents.filter(d => selectedRows.map(r => r.original.id).includes(d.id)) : undefined}
        title="AI Rescreen Selected Documents"
        actionLabel="Start Rescreening"
      />
    </>
  )
} 