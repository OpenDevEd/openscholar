// The icons that stand for a section of the app, in the brand's two-tone style.
// The sidebar, page headers and settings rails all read from here, so a section
// has one icon everywhere and changing it is one line.
//
// Icons: Solar by 480 Design, CC BY 4.0, credited on /credits. The lighter tone
// is --solar-secondary-opacity in globals.css.
import type { ComponentType } from "react";

/** Any icon component the app can place: a section icon from here, or a Lucide one. */
export type AppIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

export { Home2Icon as HomeIcon } from "@solar-icons/react/bold-duotone/home-2";
export { LibraryIcon } from "@solar-icons/react/bold-duotone/library";
export { BookBookmarkIcon as BookmarksIcon } from "@solar-icons/react/bold-duotone/book-bookmark";
export { HistoryIcon } from "@solar-icons/react/bold-duotone/history";
export { DatabaseIcon as ExtractionIcon, DatabaseIcon as SourcesIcon } from "@solar-icons/react/bold-duotone/database";
export { StructureIcon as TopicsIcon } from "@solar-icons/react/bold-duotone/structure";
export { UsersGroupRoundedIcon as AuthorsIcon, UsersGroupRoundedIcon as TeamIcon } from "@solar-icons/react/bold-duotone/users-group-rounded";
export { LayersIcon as EvidenceLibrariesIcon } from "@solar-icons/react/bold-duotone/layers";
export { SettingsIcon } from "@solar-icons/react/bold-duotone/settings";
export { UserRoundedIcon as PersonIcon } from "@solar-icons/react/bold-duotone/user-rounded";
export { ShieldCheckIcon as SecurityIcon } from "@solar-icons/react/bold-duotone/shield-check";
export { CardIcon as BillingIcon } from "@solar-icons/react/bold-duotone/card";
export { BotIcon } from "@solar-icons/react/bold-duotone/bot";
export { StarsIcon as SparklesIcon } from "@solar-icons/react/bold-duotone/stars";
export { PlugCircleIcon as ConnectionsIcon } from "@solar-icons/react/bold-duotone/plug-circle";
export { Tuning2Icon as SwitchesIcon } from "@solar-icons/react/bold-duotone/tuning-2";
export { BoxIcon as ModelsIcon } from "@solar-icons/react/bold-duotone/box";
export { ShieldUserIcon as AdminsIcon } from "@solar-icons/react/bold-duotone/shield-user";
export { DocumentTextIcon as DocumentIcon } from "@solar-icons/react/bold-duotone/document-text";
export { ChatSquareIcon as ChatIcon } from "@solar-icons/react/bold-duotone/chat-square";
export { GlobalIcon as GlobeIcon } from "@solar-icons/react/bold-duotone/global";
export { PaletteIcon } from "@solar-icons/react/bold-duotone/palette";
export { Buildings2Icon as BuildingsIcon } from "@solar-icons/react/bold-duotone/buildings-2";
export { HamburgerMenuIcon as MenuIcon } from "@solar-icons/react/bold-duotone/hamburger-menu";
export { PanelBottomIcon as FooterIcon } from "@solar-icons/react/bold-duotone/panel-bottom";
export { LetterIcon as MailIcon } from "@solar-icons/react/bold-duotone/letter";
export { FolderWithFilesIcon as CollectionsIcon } from "@solar-icons/react/bold-duotone/folder-with-files";
export { MagnifierIcon as SearchIcon } from "@solar-icons/react/bold-duotone/magnifier";
export { QuoteIcon } from "@solar-icons/react/bold-duotone/quote";
export { Dialog2Icon as LanguagesIcon } from "@solar-icons/react/bold-duotone/dialog-2";
export { Chart2Icon as AnalyticsIcon } from "@solar-icons/react/bold-duotone/chart-2";
export { LinkIcon } from "@solar-icons/react/bold-duotone/link";
export { Plane2Icon as PublishIcon } from "@solar-icons/react/bold-duotone/plane-2";
export { TrashBinTrashIcon as TrashIcon } from "@solar-icons/react/bold-duotone/trash-bin-trash";
export { Book2Icon as BookIcon } from "@solar-icons/react/bold-duotone/book-2";
