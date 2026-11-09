/**
 * App icon set — Hugeicons (free, stroke-rounded), exported under stable names so
 * components don't depend on the icon library directly. Swap a mapping here to restyle everywhere.
 */
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import {
  Add01Icon,
  Alert02Icon,
  AppWindowMacIcon,
  ArrowDown01Icon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  AspectRatioIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ClapperboardIcon,
  ComputerIcon,
  ComputerRemoveIcon,
  Cursor01Icon,
  DashboardSpeed02Icon,
  Delete02Icon,
  Folder01Icon,
  FolderOpenIcon,
  Image02Icon,
  CommandIcon,
  FullScreenIcon,
  LibraryIcon,
  MagicWand01Icon,
  Mic01Icon,
  MicOff01Icon,
  MonitorSpeakerIcon,
  NextIcon,
  PowerIcon,
  PreviousIcon,
  Redo02Icon,
  RotateCcwIcon,
  ScissorIcon,
  Search01Icon,
  Settings01Icon,
  Settings02Icon,
  ShuffleIcon,
  SlidersHorizontalIcon,
  SmartPhone01Icon,
  SparklesIcon,
  SquareDashedIcon,
  SubtitleIcon,
  Layout2ColumnIcon,
  Tick02Icon,
  Undo02Icon,
  Upload04Icon,
  Video01Icon,
  VideoOffIcon,
  VolumeHighIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ViewOffSlashIcon,
  BlurIcon,
  Grid2X2Icon,
  PaintBrush02Icon,
  Settings05Icon,
  Download04Icon,
  Film01Icon,
  KeyboardIcon,
  Wrench01Icon,
  ComputerVideoIcon,
  MusicNote01Icon,
  AudioWave01Icon,
  ClosedCaptionIcon,
  UserCircleIcon,
  CrownIcon,
  Mail01Icon,
  LockPasswordIcon,
  CreditCardIcon,
  Logout01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  SquareLock02Icon,
  ShieldUserIcon,
  PencilEdit02Icon
} from '@hugeicons/core-free-icons'

export interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
  /** solid icons only (Play, Pause, Square, Star) */
  fill?: string
}

const DEFAULT_STROKE = 1.6

function make(icon: IconSvgElement, name: string): (p: IconProps) => React.JSX.Element {
  const C = ({ size = 18, strokeWidth = DEFAULT_STROKE, className }: IconProps): React.JSX.Element => (
    <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} className={className} aria-hidden />
  )
  C.displayName = name
  return C
}

// ---- solid glyphs (media controls look better filled) ------------------------

function solid(name: string, path: string, outline?: string): (p: IconProps) => React.JSX.Element {
  const C = ({ size = 18, className, fill }: IconProps): React.JSX.Element => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      {fill && fill !== 'none' ? (
        <path d={path} fill="currentColor" />
      ) : (
        <path
          d={outline ?? path}
          fill="none"
          stroke="currentColor"
          strokeWidth={DEFAULT_STROKE}
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
  C.displayName = name
  return C
}

export const Play = solid(
  'Play',
  'M7.5 5.3c0-1.3 1.4-2.1 2.5-1.4l9.2 5.7c1.1.7 1.1 2.2 0 2.9l-9.2 5.7c-1.1.7-2.5-.1-2.5-1.4V5.3z'
)
export const Pause = solid(
  'Pause',
  'M6.5 4.5h2.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 18V6a1.5 1.5 0 0 1 1.5-1.5zm8.5 0h2.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 15 4.5z'
)
export const Square = solid('Square', 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z')
export const Star = solid('Star', 'M12 3.4l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.4l-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.4z')

// ---- stroke icons -------------------------------------------------------------

export const AlertTriangle = make(Alert02Icon, 'AlertTriangle')
export const AppWindow = make(AppWindowMacIcon, 'AppWindow')
export const ArrowLeftToLine = make(ArrowLeftToLineIcon, 'ArrowLeftToLine')
export const ArrowRightToLine = make(ArrowRightToLineIcon, 'ArrowRightToLine')
export const Check = make(Tick02Icon, 'Check')
export const CheckCircle2 = make(CheckmarkCircle02Icon, 'CheckCircle2')
export const ChevronDown = make(ArrowDown01Icon, 'ChevronDown')
export const Clapperboard = make(ClapperboardIcon, 'Clapperboard')
export const Cog = make(Settings02Icon, 'Cog')
export const Folder = make(Folder01Icon, 'Folder')
export const FolderOpen = make(FolderOpenIcon, 'FolderOpen')
export const Gauge = make(DashboardSpeed02Icon, 'Gauge')
export const Image = make(Image02Icon, 'Image')
export const Keyboard = make(CommandIcon, 'Keyboard')
export const Library = make(LibraryIcon, 'Library')
export const Mic = make(Mic01Icon, 'Mic')
export const MicOff = make(MicOff01Icon, 'MicOff')
export const Monitor = make(ComputerIcon, 'Monitor')
export const MonitorSpeaker = make(MonitorSpeakerIcon, 'MonitorSpeaker')
export const MonitorX = make(ComputerRemoveIcon, 'MonitorX')
export const MousePointer2 = make(Cursor01Icon, 'MousePointer2')
export const Plus = make(Add01Icon, 'Plus')
export const Power = make(PowerIcon, 'Power')
export const RectangleHorizontal = make(AspectRatioIcon, 'RectangleHorizontal')
export const Redo2 = make(Redo02Icon, 'Redo2')
export const RotateCcw = make(RotateCcwIcon, 'RotateCcw')
export const Scissors = make(ScissorIcon, 'Scissors')
export const Search = make(Search01Icon, 'Search')
export const Settings = make(Settings01Icon, 'Settings')
export const Shuffle = make(ShuffleIcon, 'Shuffle')
export const SkipBack = make(PreviousIcon, 'SkipBack')
export const SkipForward = make(NextIcon, 'SkipForward')
export const SlidersHorizontal = make(SlidersHorizontalIcon, 'SlidersHorizontal')
export const Smartphone = make(SmartPhone01Icon, 'Smartphone')
export const Sparkles = make(SparklesIcon, 'Sparkles')
export const MagicWand = make(MagicWand01Icon, 'MagicWand')
export const SquareDashed = make(SquareDashedIcon, 'SquareDashed')
export const Subtitle = make(SubtitleIcon, 'Subtitle')
export const LayoutSplit = make(Layout2ColumnIcon, 'LayoutSplit')
export const SquareRoundCorner = make(FullScreenIcon, 'SquareRoundCorner')
export const Trash = make(Delete02Icon, 'Trash')
export const Undo2 = make(Undo02Icon, 'Undo2')
export const Upload = make(Upload04Icon, 'Upload')
export const Video = make(Video01Icon, 'Video')
export const VideoOff = make(VideoOffIcon, 'VideoOff')
export const Volume2 = make(VolumeHighIcon, 'Volume2')
export const X = make(Cancel01Icon, 'X')
export const ZoomIn = make(ZoomInIcon, 'ZoomIn')
export const ZoomOut = make(ZoomOutIcon, 'ZoomOut')
export const EyeOff = make(ViewOffSlashIcon, 'EyeOff')
export const Blur = make(BlurIcon, 'Blur')
export const Pixelate = make(Grid2X2Icon, 'Pixelate')
export const Brush = make(PaintBrush02Icon, 'Brush')
export const Sliders = make(Settings05Icon, 'Sliders')
export const Download = make(Download04Icon, 'Download')
export const Film = make(Film01Icon, 'Film')
export const KeyboardKeys = make(KeyboardIcon, 'KeyboardKeys')
export const Wrench = make(Wrench01Icon, 'Wrench')
export const ScreenRecord = make(ComputerVideoIcon, 'ScreenRecord')
export const Music = make(MusicNote01Icon, 'Music')
export const Waveform = make(AudioWave01Icon, 'Waveform')
export const Captions = make(ClosedCaptionIcon, 'Captions')
export const User = make(UserCircleIcon, 'User')
export const Crown = make(CrownIcon, 'Crown')
export const Mail = make(Mail01Icon, 'Mail')
export const KeyLock = make(LockPasswordIcon, 'KeyLock')
export const CreditCard = make(CreditCardIcon, 'CreditCard')
export const LogOut = make(Logout01Icon, 'LogOut')
export const Refresh = make(ArrowReloadHorizontalIcon, 'Refresh')
export const ChevronRight = make(ArrowRight01Icon, 'ChevronRight')
export const ChevronLeft = make(ArrowLeft01Icon, 'ChevronLeft')
export const Lock = make(SquareLock02Icon, 'Lock')
export const Shield = make(ShieldUserIcon, 'Shield')
export const Pencil = make(PencilEdit02Icon, 'Pencil')
