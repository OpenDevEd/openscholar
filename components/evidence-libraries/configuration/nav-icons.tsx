import {
  BarChart3,
  BookOpen,
  CircleHelp,
  Info,
  LayoutGrid,
  Library,
  type LucideIcon,
  Mail,
  Map,
  MessageSquare,
  Newspaper,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { NavIcon } from "@/lib/evidence-libraries/configuration/links";

/**
 * A lucide glyph that stands in for each runtime navigation icon in the
 * picker. The public site draws its own icons; these only help the owner
 * recognise the choice.
 */
export const NAV_ICON_GLYPHS: Record<NavIcon, LucideIcon> = {
  AboutUs: Info,
  EvidenceLibrary: Library,
  Programs: LayoutGrid,
  Blog: Newspaper,
  Team: Users,
  ContactUs: Mail,
  TeamFill: Users,
  ToolsFill: Wrench,
  BookOpenFill: BookOpen,
  Bookshelf: Library,
  ChatRightDotsFill: MessageSquare,
  BsMapFill: Map,
  LuX: X,
  FaQuestionCircle: CircleHelp,
  IoStatsChart: BarChart3,
};
