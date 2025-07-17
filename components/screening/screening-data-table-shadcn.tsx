"use client"

import React, { useState } from 'react'
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  Table as ReactTable,
  HeaderGroup,
  Header,
  Row,
  Cell,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, Maximize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { generateScreeningCsv } from '@/lib/screening-utils';

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

interface TableContentProps {
  table: ReactTable<any>
  columns: ColumnDef<any>[]
  selectedRows: Row<any>[]
  handleDeleteSelected: () => void
  handleRescreenSelected: () => void
  handleExportSelected: () => void
}

const TableContent = ({ 
  table, 
  columns, 
  selectedRows, 
  handleDeleteSelected, 
  handleRescreenSelected, 
  handleExportSelected 
}: TableContentProps) => {
  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="rounded-md border flex-1 overflow-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup: HeaderGroup<any>) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header: Header<any, unknown>) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row: Row<any>) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell: Cell<any, unknown>) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-sm">Rows:</span>
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger className="h-8 w-[80px]">
                <SelectValue placeholder={table.getState().pagination.pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
      
      {selectedRows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap p-2 px-4 bg-muted rounded-md">
          <span className="text-sm font-medium">{selectedRows.length} selected</span>
          <Button size="sm" variant="destructive" onClick={handleDeleteSelected} className="w-full sm:w-auto">
            Delete
          </Button>
          <Button size="sm" variant="default" onClick={handleRescreenSelected} className="w-full sm:w-auto">
            AI Rescreen
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportSelected} className="w-full sm:w-auto">
            Export CSV
          </Button>
        </div>
      )}
    </div>
  )
}

export function ScreeningDataTableShadcn({ data, questions }: ScreeningDataTableProps) {
  "use no memo";
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState({})
  const [showRescreenDialog, setShowRescreenDialog] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

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
        accessorKey: "id",
        header: () => <span>ID</span>,
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
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Title
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
        cell: ({ row }) => (
          <div className="font-medium max-w-[300px]">
            <TruncatedTextWithPopover text={row.getValue("title")} />
          </div>
        ),
      },
      {
        accessorKey: "abstract",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Abstract
              <ArrowUpDown className="ml-2 h-4 w-4" />
            </Button>
          )
        },
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

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
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
        <div className="flex items-center py-4">
          <Input
            placeholder="Filter titles..."
            value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("title")?.setFilterValue(event.target.value)
            }
            className="max-w-sm"
          />
          <div className="flex items-center gap-2 ml-auto">
            <Sheet open={isFullscreen} onOpenChange={setIsFullscreen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title="View in fullscreen"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-none p-6 overflow-hidden !outline-none [&>button]:!bg-white [&>button]:!opacity-100 [&>button]:border [&>button]:shadow-sm [&>button]:rounded-md [&>button]:p-2 [&>button]:h-10 [&>button]:w-10 [&>button]:flex [&>button]:items-center [&>button]:justify-center">
                <SheetHeader className="sr-only">
                  <SheetTitle>Screening Results Fullscreen View</SheetTitle>
                </SheetHeader>
                <div className="h-full">
                  <TableContent
                    table={table}
                    columns={columns}
                    selectedRows={selectedRows}
                    handleDeleteSelected={handleDeleteSelected}
                    handleRescreenSelected={handleRescreenSelected}
                    handleExportSelected={handleExportSelected}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  Columns <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {column.id}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        <TableContent
          table={table}
          columns={columns}
          selectedRows={selectedRows}
          handleDeleteSelected={handleDeleteSelected}
          handleRescreenSelected={handleRescreenSelected}
          handleExportSelected={handleExportSelected}
        />
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