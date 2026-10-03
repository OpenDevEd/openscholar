// Every icon the app shows, by the name the app uses for it. Components import
// icons from here and never from an icon package, so the app's icon style is
// set in this one file: to change an icon, change its line.
//
// The style is the brand's two-tone one, from Solar's bold duotone set (Solar by
// 480 Design, CC BY 4.0, credited on /credits). The lighter tone is a solid colour,
// set by --icon-tone in globals.css. Chevrons use Solar's line style,
// because a filled chevron reads as a play button.
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { StarIcon as StarSolid } from "@solar-icons/react/bold-duotone/star";
import { StarIcon as StarOutline } from "@solar-icons/react/linear/star";

/** Any icon component the app can place. */
export type AppIcon = ComponentType<ComponentPropsWithoutRef<"svg"> & { size?: string | number }>;

// Sections of the app. The sidebar, page headers and settings rails share these.
export { Home2Icon as HomeIcon, Home2Icon as Home } from "@solar-icons/react/bold-duotone/home-2";
export { LibraryIcon, LibraryIcon as Library, LibraryIcon as LibraryBig } from "@solar-icons/react/bold-duotone/library";
export { BookBookmarkIcon as BookmarksIcon } from "@solar-icons/react/bold-duotone/book-bookmark";
export { HistoryIcon, HistoryIcon as History, HistoryIcon as TimerReset } from "@solar-icons/react/bold-duotone/history";
export { DatabaseIcon as ExtractionIcon, DatabaseIcon as SourcesIcon, DatabaseIcon as Database } from "@solar-icons/react/bold-duotone/database";
export { StructureIcon as TopicsIcon, StructureIcon as Network } from "@solar-icons/react/bold-duotone/structure";
export { UsersGroupRoundedIcon as AuthorsIcon, UsersGroupRoundedIcon as TeamIcon, UsersGroupRoundedIcon as Users } from "@solar-icons/react/bold-duotone/users-group-rounded";
export { LayersIcon as EvidenceLibrariesIcon, LayersIcon as Layers } from "@solar-icons/react/bold-duotone/layers";
export { SettingsIcon, SettingsIcon as Settings } from "@solar-icons/react/bold-duotone/settings";
export { UserRoundedIcon as PersonIcon, UserRoundedIcon as UserRound } from "@solar-icons/react/bold-duotone/user-rounded";
export { ShieldCheckIcon as SecurityIcon, ShieldCheckIcon as ShieldCheck } from "@solar-icons/react/bold-duotone/shield-check";
export { CardIcon as BillingIcon, CardIcon as CreditCard } from "@solar-icons/react/bold-duotone/card";
export { BotIcon } from "@solar-icons/react/bold-duotone/bot";
export { StarsIcon as SparklesIcon, StarsIcon as Sparkles } from "@solar-icons/react/bold-duotone/stars";
export { PlugCircleIcon as ConnectionsIcon, PlugCircleIcon as Plug } from "@solar-icons/react/bold-duotone/plug-circle";
export { Tuning2Icon as SwitchesIcon, Tuning2Icon as SlidersHorizontal, Tuning2Icon as Settings2, Tuning2Icon as SlidersHorizontalIcon, Tuning2Icon as ToggleLeft } from "@solar-icons/react/bold-duotone/tuning-2";
export { BoxIcon as ModelsIcon, BoxIcon as Package, BoxIcon as Boxes } from "@solar-icons/react/bold-duotone/box";
export { ShieldUserIcon as AdminsIcon } from "@solar-icons/react/bold-duotone/shield-user";
export { DocumentTextIcon as DocumentIcon, DocumentTextIcon as FileText } from "@solar-icons/react/bold-duotone/document-text";
export { ChatSquareIcon as ChatIcon, ChatSquareIcon as MessageSquare, ChatSquareIcon as MessageSquareText } from "@solar-icons/react/bold-duotone/chat-square";
export { GlobalIcon as GlobeIcon, GlobalIcon as Globe } from "@solar-icons/react/bold-duotone/global";
export { PaletteIcon } from "@solar-icons/react/bold-duotone/palette";
export { Buildings2Icon as BuildingsIcon, Buildings2Icon as Building2 } from "@solar-icons/react/bold-duotone/buildings-2";
export { HamburgerMenuIcon as MenuIcon } from "@solar-icons/react/bold-duotone/hamburger-menu";
export { PanelBottomIcon as FooterIcon } from "@solar-icons/react/bold-duotone/panel-bottom";
export { LetterIcon as MailIcon, LetterIcon as Mail } from "@solar-icons/react/bold-duotone/letter";
export { FolderWithFilesIcon as CollectionsIcon } from "@solar-icons/react/bold-duotone/folder-with-files";
export { MagnifierIcon as SearchIcon, MagnifierIcon as Search } from "@solar-icons/react/bold-duotone/magnifier";
export { QuoteIcon, QuoteIcon as Quote } from "@solar-icons/react/bold-duotone/quote";
export { Dialog2Icon as LanguagesIcon, Dialog2Icon as Languages } from "@solar-icons/react/bold-duotone/dialog-2";
export { Chart2Icon as AnalyticsIcon, Chart2Icon as BarChart3 } from "@solar-icons/react/bold-duotone/chart-2";
export { LinkIcon, LinkIcon as Link2 } from "@solar-icons/react/bold-duotone/link";
export { Plane2Icon as PublishIcon, Plane2Icon as Send } from "@solar-icons/react/bold-duotone/plane-2";
export { TrashBinTrashIcon as TrashIcon, TrashBinTrashIcon as Trash2, TrashBinTrashIcon as Trash2Icon } from "@solar-icons/react/bold-duotone/trash-bin-trash";
export { Book2Icon as BookIcon, Book2Icon as BookOpen } from "@solar-icons/react/bold-duotone/book-2";

/**
 * A star that is solid when it is given a fill-* class and an outline when it
 * is not, which is how rating and favourite controls mark filled and empty.
 */
export function Star({ className, ...props }: ComponentPropsWithoutRef<"svg">) {
  const Icon = /(^|\s)fill-(?!none)/.test(className ?? "") ? StarSolid : StarOutline;
  return <Icon className={className} {...props} />;
}

// Everything else.
export { CloseIcon as X, CloseIcon as XIcon } from "@solar-icons/react/bold-duotone/close";
export { CheckIcon as Check, CheckIcon } from "@solar-icons/react/bold-duotone/check";
export { AddIcon as Plus, AddIcon as PlusIcon } from "@solar-icons/react/bold-duotone/add";
export { AltArrowRightIcon as ChevronRight, AltArrowRightIcon as ChevronRightIcon } from "@solar-icons/react/linear/alt-arrow-right";
export { SquareArrowRightUpIcon as ExternalLink, SquareArrowRightUpIcon as ExternalLinkIcon } from "@solar-icons/react/bold-duotone/square-arrow-right-up";
export { AltArrowDownIcon as ChevronDown, AltArrowDownIcon as ChevronDownIcon } from "@solar-icons/react/linear/alt-arrow-down";
export { RefreshIcon as RefreshCw, RefreshIcon as RefreshCwIcon } from "@solar-icons/react/bold-duotone/refresh";
export { AltArrowLeftIcon as ChevronLeft, AltArrowLeftIcon as ChevronLeftIcon } from "@solar-icons/react/linear/alt-arrow-left";
export { ArrowRightIcon as ArrowRight, ArrowRightIcon } from "@solar-icons/react/bold-duotone/arrow-right";
export { MagnifierCloseIcon as SearchX } from "@solar-icons/react/bold-duotone/magnifier-close";
export { PenIcon as Pencil } from "@solar-icons/react/bold-duotone/pen";
export { DollarMinimalisticIcon as Coins, DollarMinimalisticIcon as CoinsIcon } from "@solar-icons/react/bold-duotone/dollar-minimalistic";
export { ClockCircleIcon as Clock, ClockCircleIcon as Clock3, ClockCircleIcon as ClockIcon } from "@solar-icons/react/bold-duotone/clock-circle";
export { RestartIcon as RotateCcw, RestartIcon as RotateCw } from "@solar-icons/react/bold-duotone/restart";
export { CopyIcon as Copy, CopyIcon } from "@solar-icons/react/bold-duotone/copy";
export { ArrowRightUpIcon as ArrowUpRight } from "@solar-icons/react/bold-duotone/arrow-right-up";
export { ChecklistMinimalisticIcon as ListChecks } from "@solar-icons/react/bold-duotone/checklist-minimalistic";
export { DownloadMinimalisticIcon as Download, DownloadMinimalisticIcon as DownloadIcon } from "@solar-icons/react/bold-duotone/download-minimalistic";
export { ChevronsUpDownIcon as ChevronsUpDown } from "@solar-icons/react/linear/chevrons-up-down";
export { DangerCircleIcon as AlertCircle, DangerCircleIcon as CircleAlert, DangerCircleIcon as AlertCircleIcon } from "@solar-icons/react/bold-duotone/danger-circle";
export { MagicWand2Icon as Wand2 } from "@solar-icons/react/bold-duotone/magic-wand-2";
export { SortVerticalIcon as ArrowUpDown } from "@solar-icons/react/bold-duotone/sort-vertical";
export { DangerTriangleIcon as AlertTriangle, DangerTriangleIcon as TriangleAlert } from "@solar-icons/react/bold-duotone/danger-triangle";
export { BoltIcon as Zap } from "@solar-icons/react/bold-duotone/bolt";
export { MenuDotsIcon as MoreHorizontal, MenuDotsIcon as MoreHorizontalIcon } from "@solar-icons/react/bold-duotone/menu-dots";
export { KeyIcon as KeyRound } from "@solar-icons/react/bold-duotone/key";
export { ArrowLeftIcon as ArrowLeft, ArrowLeftIcon } from "@solar-icons/react/bold-duotone/arrow-left";
export { UploadMinimalisticIcon as Upload } from "@solar-icons/react/bold-duotone/upload-minimalistic";
export { DisketteIcon as Save } from "@solar-icons/react/bold-duotone/diskette";
export { PlayIcon as Play } from "@solar-icons/react/bold-duotone/play";
export { FilterIcon as ListFilter, FilterIcon as Filter } from "@solar-icons/react/bold-duotone/filter";
export { EarthIcon as Globe2 } from "@solar-icons/react/bold-duotone/earth";
export { FolderOpenIcon as FolderOpen } from "@solar-icons/react/bold-duotone/folder-open";
export { FolderIcon as Folder } from "@solar-icons/react/bold-duotone/folder";
export { CircleDashedIcon as CircleDashed } from "@solar-icons/react/bold-duotone/circle-dashed";
export { CheckCircleIcon as CheckCircle2, CheckCircleIcon as CircleCheck } from "@solar-icons/react/bold-duotone/check-circle";
export { MedalRibbonStarIcon as Award } from "@solar-icons/react/bold-duotone/medal-ribbon-star";
export { PenNewSquareIcon as PencilLine, PenNewSquareIcon as PenLine } from "@solar-icons/react/bold-duotone/pen-new-square";
export { PauseIcon as Pause } from "@solar-icons/react/bold-duotone/pause";
export { PanelLeftOpenIcon as PanelLeftOpen } from "@solar-icons/react/bold-duotone/panel-left-open";
export { MonitorIcon as Monitor } from "@solar-icons/react/bold-duotone/monitor";
export { LockIcon as Lock } from "@solar-icons/react/bold-duotone/lock";
export { ListIcon as List } from "@solar-icons/react/bold-duotone/list";
export { TargetIcon as Focus, TargetIcon as Target } from "@solar-icons/react/bold-duotone/target";
export { FileSearchIcon as FileSearch } from "@solar-icons/react/bold-duotone/file-search";
export { CrownIcon as Crown } from "@solar-icons/react/bold-duotone/crown";
export { CloseCircleIcon as CircleX, CloseCircleIcon as XCircle } from "@solar-icons/react/bold-duotone/close-circle";
export { AltArrowUpIcon as ChevronUp, AltArrowUpIcon as ChevronUpIcon } from "@solar-icons/react/linear/alt-arrow-up";
export { CalendarIcon as Calendar, CalendarIcon, CalendarIcon as CalendarDays } from "@solar-icons/react/bold-duotone/calendar";
export { BookmarkPlusIcon as BookmarkPlus } from "@solar-icons/react/bold-duotone/bookmark-plus";
export { ArrowUpIcon as ArrowUp } from "@solar-icons/react/bold-duotone/arrow-up";
export { WiFiOffIcon as WifiOffIcon } from "@solar-icons/react/bold-duotone/wi-fi-off";
export { UnlinkIcon as Unlink } from "@solar-icons/react/bold-duotone/unlink";
export { StopIcon as SquareIcon } from "@solar-icons/react/bold-duotone/stop";
export { ShieldIcon } from "@solar-icons/react/bold-duotone/shield";
export { ShieldWarningIcon as ShieldAlertIcon, ShieldWarningIcon as ShieldAlert } from "@solar-icons/react/bold-duotone/shield-warning";
export { Widget5Icon as Shapes } from "@solar-icons/react/bold-duotone/widget-5";
export { RocketIcon as Rocket } from "@solar-icons/react/bold-duotone/rocket";
export { PanelLeftIcon as PanelLeft } from "@solar-icons/react/bold-duotone/panel-left";
export { MinusIcon as Minus } from "@solar-icons/react/bold-duotone/minus";
export { Logout2Icon as LogOut } from "@solar-icons/react/bold-duotone/logout-2";
export { Login2Icon as LogIn } from "@solar-icons/react/bold-duotone/login-2";
export { Grid2x2Icon as LayoutGrid } from "@solar-icons/react/bold-duotone/grid-2x2";
export { InfoCircleIcon as Info } from "@solar-icons/react/bold-duotone/info-circle";
export { GalleryIcon as ImageIcon } from "@solar-icons/react/bold-duotone/gallery";
export { HandMoneyIcon as HandCoins } from "@solar-icons/react/bold-duotone/hand-money";
export { GripVerticalIcon as GripVertical } from "@solar-icons/react/bold-duotone/grip-vertical";
export { AddFolderIcon as FolderPlus } from "@solar-icons/react/bold-duotone/add-folder";
export { FileSendIcon as FileUp } from "@solar-icons/react/bold-duotone/file-send";
export { CameraIcon as Camera } from "@solar-icons/react/bold-duotone/camera";
export { BrainIcon as Brain, BrainIcon } from "@solar-icons/react/bold-duotone/brain";
export { ClipboardCheckIcon as BookCheck } from "@solar-icons/react/bold-duotone/clipboard-check";
export { ForbiddenCircleIcon as BanIcon, ForbiddenCircleIcon as Ban } from "@solar-icons/react/bold-duotone/forbidden-circle";
export { ArrowDownIcon as ArrowDown, ArrowDownIcon } from "@solar-icons/react/bold-duotone/arrow-down";
export { AlignLeftIcon as AlignLeft } from "@solar-icons/react/bold-duotone/align-left";
export { MagnifierZoomOutIcon as ZoomOut } from "@solar-icons/react/bold-duotone/magnifier-zoom-out";
export { MagnifierZoomInIcon as ZoomIn } from "@solar-icons/react/bold-duotone/magnifier-zoom-in";
export { UserIcon as User } from "@solar-icons/react/bold-duotone/user";
export { LockUnlockedIcon as Unlock, LockUnlockedIcon as LockOpen } from "@solar-icons/react/bold-duotone/lock-unlocked";
export { UndoLeftIcon as Undo2 } from "@solar-icons/react/bold-duotone/undo-left";
export { GraphUpIcon as TrendingUp } from "@solar-icons/react/bold-duotone/graph-up";
export { GraphDownIcon as TrendingDown } from "@solar-icons/react/bold-duotone/graph-down";
export { TabletIcon as Tablet } from "@solar-icons/react/bold-duotone/tablet";
export { TablePropertiesIcon as TableProperties } from "@solar-icons/react/bold-duotone/table-properties";
export { TableIcon as Table2, TableIcon as Table } from "@solar-icons/react/bold-duotone/table";
export { Sun2Icon as Sun } from "@solar-icons/react/bold-duotone/sun-2";
export { StopCircleIcon } from "@solar-icons/react/bold-duotone/stop-circle";
export { MinusSquareIcon as SquareMinus } from "@solar-icons/react/bold-duotone/minus-square";
export { SortFromBottomToTopIcon as SortAsc } from "@solar-icons/react/bold-duotone/sort-from-bottom-to-top";
export { SmartphoneIcon as Smartphone } from "@solar-icons/react/bold-duotone/smartphone";
export { ShareIcon as Share2 } from "@solar-icons/react/bold-duotone/share";
export { RepeatIcon as Repeat2, RepeatIcon as Repeat } from "@solar-icons/react/bold-duotone/repeat";
export { StationIcon as RadioTower } from "@solar-icons/react/bold-duotone/station";
export { Safe2Icon as PiggyBank } from "@solar-icons/react/bold-duotone/safe-2";
export { PaperclipIcon as Paperclip } from "@solar-icons/react/bold-duotone/paperclip";
export { PanelRightOpenIcon, PanelRightOpenIcon as PanelRightOpen } from "@solar-icons/react/bold-duotone/panel-right-open";
export { PanelRightCloseIcon as PanelRightClose } from "@solar-icons/react/bold-duotone/panel-right-close";
export { PanelLeftCloseIcon as PanelLeftClose } from "@solar-icons/react/bold-duotone/panel-left-close";
export { BoxMinimalisticIcon as PackageOpen } from "@solar-icons/react/bold-duotone/box-minimalistic";
export { MenuDotsVerticalIcon as MoreVertical } from "@solar-icons/react/bold-duotone/menu-dots-vertical";
export { MoonIcon as Moon } from "@solar-icons/react/bold-duotone/moon";
export { MinimizeIcon as Minimize2 } from "@solar-icons/react/bold-duotone/minimize";
export { ChatRoundAddIcon as MessageSquarePlus } from "@solar-icons/react/bold-duotone/chat-round-add";
export { MaximizeIcon as Maximize2Icon, MaximizeIcon as Expand } from "@solar-icons/react/bold-duotone/maximize";
export { LeafIcon as Leaf } from "@solar-icons/react/bold-duotone/leaf";
export { LayoutListIcon as LayoutList } from "@solar-icons/react/bold-duotone/layout-list";
export { TextItalicIcon as Italic } from "@solar-icons/react/bold-duotone/text-italic";
export { InboxIcon as Inbox } from "@solar-icons/react/bold-duotone/inbox";
export { ImportIcon as Import } from "@solar-icons/react/bold-duotone/import";
export { QuestionCircleIcon as HelpCircle, QuestionCircleIcon as CircleHelp } from "@solar-icons/react/bold-duotone/question-circle";
export { HeartPulseIcon as HeartPulse } from "@solar-icons/react/bold-duotone/heart-pulse";
export { HashtagIcon as Hash } from "@solar-icons/react/bold-duotone/hashtag";
export { ServerIcon as HardDrive } from "@solar-icons/react/bold-duotone/server";
export { SledgehammerIcon as Hammer } from "@solar-icons/react/bold-duotone/sledgehammer";
export { Grid3x3Icon as Grid3X3 } from "@solar-icons/react/bold-duotone/grid-3x3";
export { SquareAcademicCapIcon as GraduationCap } from "@solar-icons/react/bold-duotone/square-academic-cap";
export { TransferHorizontalIcon as GitCompare } from "@solar-icons/react/bold-duotone/transfer-horizontal";
export { FolderCheckIcon as FolderCheck } from "@solar-icons/react/bold-duotone/folder-check";
export { TestTubeIcon as FlaskConical } from "@solar-icons/react/bold-duotone/test-tube";
export { FileRemoveIcon as FileX2, FileRemoveIcon as FileX } from "@solar-icons/react/bold-duotone/file-remove";
export { FileSpreadsheetIcon as FileSpreadsheet } from "@solar-icons/react/bold-duotone/file-spreadsheet";
export { CodeFileIcon as FileJson } from "@solar-icons/react/bold-duotone/code-file";
export { FileCheckIcon as FileCheck2 } from "@solar-icons/react/bold-duotone/file-check";
export { EyeIcon as Eye } from "@solar-icons/react/bold-duotone/eye";
export { UndoLeftRoundIcon as CornerDownLeftIcon } from "@solar-icons/react/bold-duotone/undo-left-round";
export { Columns3Icon as Columns3 } from "@solar-icons/react/bold-duotone/columns-3";
export { CloudUploadIcon as CloudUpload } from "@solar-icons/react/bold-duotone/cloud-upload";
export { CloudIcon as Cloud } from "@solar-icons/react/bold-duotone/cloud";
export { ClipboardListIcon as ClipboardList } from "@solar-icons/react/bold-duotone/clipboard-list";
export { PauseCircleIcon as CirclePause } from "@solar-icons/react/bold-duotone/pause-circle";
export { CheckReadIcon as CheckCheck } from "@solar-icons/react/bold-duotone/check-read";
export { CalendarDateIcon as CalendarClock } from "@solar-icons/react/bold-duotone/calendar-date";
export { BuildingsIcon as Building } from "@solar-icons/react/bold-duotone/buildings";
export { ClipboardAddIcon as BookPlus } from "@solar-icons/react/bold-duotone/clipboard-add";
export { TextBoldIcon as Bold } from "@solar-icons/react/bold-duotone/text-bold";
export { VerifiedCheckIcon as BadgeCheck } from "@solar-icons/react/bold-duotone/verified-check";
export { SortHorizontalIcon as ArrowLeftRight } from "@solar-icons/react/bold-duotone/sort-horizontal";
export { ArrowRightDownIcon as ArrowDownRight } from "@solar-icons/react/bold-duotone/arrow-right-down";
export { WindowFrameIcon as AppWindow } from "@solar-icons/react/bold-duotone/window-frame";

// Solar has no match for these: spinners, a balance scale, a few plain shapes
// and other companies' logos.
export { Asterisk, CircleIcon, Cookie, Github, Linkedin, Loader2, Loader2Icon, LoaderCircle, Scale, Youtube } from "lucide-react";
