import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { BriefcaseIcon } from "@phosphor-icons/react/dist/csr/Briefcase";
import { GridFourIcon } from "@phosphor-icons/react/dist/csr/GridFour";
import { DotsThreeOutlineIcon } from "@phosphor-icons/react/dist/csr/DotsThreeOutline";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { UserCircleIcon } from "@phosphor-icons/react/dist/csr/UserCircle";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { FlaskIcon } from "@phosphor-icons/react/dist/csr/Flask";
import { BooksIcon } from "@phosphor-icons/react/dist/csr/Books";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { BellRingingIcon } from "@phosphor-icons/react/dist/csr/BellRinging";
import { HandHeartIcon } from "@phosphor-icons/react/dist/csr/HandHeart";
import { TreeStructureIcon } from "@phosphor-icons/react/dist/csr/TreeStructure";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/csr/PlugsConnected";
import { ChatsCircleIcon } from "@phosphor-icons/react/dist/csr/ChatsCircle";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { MegaphoneIcon } from "@phosphor-icons/react/dist/csr/Megaphone";
import { FlagIcon } from "@phosphor-icons/react/dist/csr/Flag";
import { ToolboxIcon } from "@phosphor-icons/react/dist/csr/Toolbox";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link";
import { CameraIcon } from "@phosphor-icons/react/dist/csr/Camera";
import { BusIcon } from "@phosphor-icons/react/dist/csr/Bus";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CreditCardIcon } from "@phosphor-icons/react/dist/csr/CreditCard";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { TargetIcon } from "@phosphor-icons/react/dist/csr/Target";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import "./product-icon.css";

/** One flat, colourful product family. No raster downloads, 3D, gradients,
 * gloss or emoji. Utility and status controls retain the existing Lucide set.
 * Import individual modules so development doesn't compile the entire pack.
 */
export const productIcons = {
  today: [CalendarDotsIcon, "green"], calendar: [CalendarDotsIcon, "gold"],
  timetable: [CalendarDotsIcon, "green"], work: [BriefcaseIcon, "gold"],
  areas: [GridFourIcon, "green"], more: [DotsThreeOutlineIcon, "blue"],
  settings: [SlidersHorizontalIcon, "violet"], profile: [UserCircleIcon, "green"],
  security: [ShieldCheckIcon, "blue"], connections: [PlugsConnectedIcon, "gold"],
  attendance: [ClipboardTextIcon, "green"], insights: [ChartBarIcon, "violet"],
  messages: [ChatsCircleIcon, "blue"], people: [UsersThreeIcon, "green"],
  groups: [UsersThreeIcon, "violet"], building: [BuildingsIcon, "gold"],
  gate: [DoorOpenIcon, "green"], resources: [ToolboxIcon, "gold"],
  facilities: [ToolboxIcon, "green"], accommodation: [BuildingsIcon, "green"],
  dining: [ForkKnifeIcon, "gold"],
  simulation: [FlaskIcon, "gold"], learning: [BooksIcon, "blue"],
  notifications: [BellRingingIcon, "gold"], invitations: [EnvelopeSimpleIcon, "blue"],
  fees: [WalletIcon, "green"], finance: [CreditCardIcon, "green"],
  updates: [MegaphoneIcon, "gold"], schedule: [ClockIcon, "blue"],
  responsibilities: [FlagIcon, "violet"], care: [HandHeartIcon, "green"],
  feedback: [TargetIcon, "violet"], policies: [FileTextIcon, "blue"],
  organization: [TreeStructureIcon, "green"], relationships: [LinkIcon, "violet"],
  camera: [CameraIcon, "blue"], transport: [BusIcon, "blue"],
  completed: [CheckCircleIcon, "green"], records: [FileTextIcon, "gold"],
} as const;
export type ProductIconName = keyof typeof productIcons;

export function ProductIcon({ name, size = 28, className = "", muted = false }: {
  readonly name: ProductIconName;
  readonly size?: number;
  readonly className?: string;
  /** Small inactive navigation glyphs can inherit the surrounding neutral ink. */
  readonly muted?: boolean;
}) {
  const [Glyph, tone] = productIcons[name];
  return <Glyph weight="duotone" size={size} className={`product-icon ${className}`.trim()}
    data-product-icon={name} data-tone={muted ? "neutral" : tone} aria-hidden="true" focusable="false" />;
}

export function productIconForDestination(href: string, fallback?: string | null): ProductIconName {
  if (/\/dining(?:[/?#]|$)/.test(href)) return "dining";
  if (/\/accommodation(?:[/?#]|$)/.test(href)) return "accommodation";
  if (/\/facilities(?:[/?#]|$)/.test(href)) return "facilities";
  if (/\/security(?:[/?#]|$)/.test(href)) return "security";
  if (/\/account(?:[/?#]|$)|\/profile(?:[/?#]|$)/.test(href)) return "profile";
  if (/connections/.test(href)) return "connections";
  if (/responsibilit/.test(href)) return "responsibilities";
  if (/feedback/.test(href)) return "feedback";
  if (/polic|governance/.test(href)) return "policies";
  if (/campus-view|spaces/.test(href)) return "building";
  if (/verification/.test(href)) return "security";
  if (/simulation/.test(href)) return "simulation";
  if (/\/groups(?:[/?#]|$)/.test(href)) return "groups";
  if (/people|student|guardian/.test(href)) return "people";
  if (/fees/.test(href)) return "fees";
  if (/finance/.test(href)) return "finance";
  if (/event|calendar|timetable/.test(href)) return "calendar";
  if (/notice|update/.test(href)) return "updates";
  if (/care|safeguard|leave/.test(href)) return "care";
  if (/message|chat/.test(href)) return "messages";
  if (/report|insight|analytic|threshold/.test(href)) return "insights";
  if (/assessment|class|learn/.test(href)) return "learning";
  return fallback && Object.hasOwn(productIcons, fallback) ? fallback as ProductIconName : "settings";
}
