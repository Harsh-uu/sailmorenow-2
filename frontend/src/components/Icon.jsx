import {
  Users, Sailboat, Handshake, Compass, ShieldCheck, Star,
  MessageCircle, CalendarDays, Pencil, Trash2, X, Share2, Send, Search,
  MapPin, User, Bell, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Plus,
  Menu, LogOut, Briefcase, Megaphone,
  Check, CheckCheck, Eye, EyeOff, CheckCircle2, AlertCircle, Info, AlertTriangle,
  // decorative / utility glyphs — the rest of the app's lucide set now lives here
  Activity, Anchor, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, Ban,
  BellOff, BellRing, Bookmark, BookmarkCheck, BookOpen, Calendar, CalendarPlus, Camera, Circle,
  ClipboardCheck, Clock, Copy, CornerDownRight, Crown, Download, ExternalLink,
  FileCheck, Flag, Gift, Globe, HandHeart, History, Image as ImageIcon, ImagePlus,
  Images, Inbox, LayoutList, Link2, List, Loader2, Mail, Map as MapIcon, MapPinned,
  MessageSquare, MessagesSquare, Monitor, Moon, Phone, RefreshCw, Repeat, Rocket,
  RotateCw, ShieldAlert, Sparkles, Sun, Tag, ThumbsDown, ThumbsUp, Ticket,
  TrendingUp, Trophy, Upload, UserPlus, Wind, Instagram, Facebook, Linkedin, Lock,
  SlidersHorizontal, MoreHorizontal,
} from "lucide-react";
import Burgee from "@/components/icons/Burgee";

/**
 * Unified web icon. The single source of truth for iconography on the web
 * surface — mirrors mobile/src/components/Icon.tsx (same semantic `name`s so
 * web + mobile stay in lockstep). New code MUST import from here and never from
 * "lucide-react" directly (enforced by the ESLint guard, which now blocks the
 * whole lucide-react module outside this file).
 *
 * Naming: semantic names first (crew, boatPro, org, events…) then decorative
 * kebab-case glyph names (arrow-right, sparkles, trophy…). Full generated
 * reference: docs/ICONS.md. Baseline: lucide strokeWidth 1.75, size scale
 * 16/20/24, color from --icon-* tokens. tone "current" = inherit parent color.
 */

export const ICONS = {
  // — semantic —
  crew: Users,
  boatOwner: Sailboat,
  boatPro: Handshake,
  directory: Handshake,
  hub: Compass,
  community: Compass,
  verified: ShieldCheck,
  org: Burgee,
  partner: Burgee,
  reviews: Star,
  messages: MessageCircle,
  events: CalendarDays,
  edit: Pencil,
  delete: Trash2,
  close: X,
  share: Share2,
  send: Send,
  search: Search,
  location: MapPin,
  profile: User,
  notifications: Bell,
  menu: Menu,
  logout: LogOut,
  myListing: Briefcase,
  myEvents: Megaphone,
  bookmark: Bookmark,
  "bookmark-filled": BookmarkCheck,
  "chevron-right": ChevronRight,
  "chevron-left": ChevronLeft,
  "chevron-down": ChevronDown,
  "chevron-up": ChevronUp,
  wind: Wind,
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  add: Plus,
  check: Check,
  checkDouble: CheckCheck,
  visibility: Eye,
  visibilityOff: EyeOff,
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
  // — decorative / utility —
  activity: Activity,
  anchor: Anchor,
  "arrow-down": ArrowDown,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  award: Award,
  ban: Ban,
  "bell-off": BellOff,
  "bell-ring": BellRing,
  "book-open": BookOpen,
  calendar: Calendar,
  "calendar-plus": CalendarPlus,
  camera: Camera,
  circle: Circle,
  "clipboard-check": ClipboardCheck,
  clock: Clock,
  copy: Copy,
  "corner-down-right": CornerDownRight,
  crown: Crown,
  download: Download,
  "external-link": ExternalLink,
  "file-check": FileCheck,
  flag: Flag,
  gift: Gift,
  globe: Globe,
  "hand-heart": HandHeart,
  history: History,
  image: ImageIcon,
  "image-plus": ImagePlus,
  images: Images,
  inbox: Inbox,
  "layout-list": LayoutList,
  link: Link2,
  list: List,
  spinner: Loader2,
  mail: Mail,
  map: MapIcon,
  "map-pinned": MapPinned,
  "sliders-horizontal": SlidersHorizontal,
  "message-square": MessageSquare,
  "messages-square": MessagesSquare,
  monitor: Monitor,
  moon: Moon,
  phone: Phone,
  refresh: RefreshCw,
  repeat: Repeat,
  rocket: Rocket,
  rotate: RotateCw,
  "shield-alert": ShieldAlert,
  sparkles: Sparkles,
  sun: Sun,
  tag: Tag,
  "thumbs-down": ThumbsDown,
  "thumbs-up": ThumbsUp,
  ticket: Ticket,
  "trending-up": TrendingUp,
  trophy: Trophy,
  upload: Upload,
  "user-plus": UserPlus,
  lock: Lock,
  more: MoreHorizontal,
};

const TONE = {
  default: "var(--icon-default)",
  muted: "var(--icon-muted)",
  accent: "var(--icon-accent)",
  brand: "var(--icon-brand)",
  onAccent: "var(--icon-on-accent)",
  disabled: "var(--icon-disabled)",
  current: "currentColor",
};

/**
 * @param {{ name: string, size?: number, tone?: keyof typeof TONE, strokeWidth?: number,
 *   label?: string, className?: string }} props
 */
export function Icon({ name, size = 20, tone = "default", strokeWidth = 1.75, label, className = "", ...rest }) {
  const Cmp = ICONS[name];
  if (!Cmp) {
    if (process.env.NODE_ENV !== "production") console.warn(`[Icon] unknown name "${name}"`);
    return null;
  }
  const a11y = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true, focusable: false };
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color={TONE[tone] ?? TONE.default}
      className={className}
      {...a11y}
      {...rest}
    />
  );
}

export default Icon;
