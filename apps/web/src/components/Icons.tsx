import type { ReactNode } from 'react';

/** 작은 선 아이콘. 색은 currentColor, 크기는 글자에 맞춘다. 장식이므로 aria-hidden — 옆에 항상 텍스트가 있다. */
const base = { width: '1em', height: '1em', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const Svg = ({ children }: { children: ReactNode }) => (
  <svg {...base} className="icon">
    {children}
  </svg>
);

export const LockIcon = () => (
  <Svg>
    <rect x="3.25" y="7.25" width="9.5" height="6.5" rx="1.5" />
    <path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75" />
  </Svg>
);
export const PinIcon = () => (
  <Svg>
    <path d="M9.5 2.5l4 4-2 .75-2.25 2.25.25 2.5-1 1-5-5 1-1 2.5.25L9.25 5z" />
    <path d="M5.5 10.5l-3 3" />
  </Svg>
);
export const BackIcon = () => (
  <Svg>
    <path d="M9.5 3.5L5 8l4.5 4.5" />
  </Svg>
);
export const NotesIcon = () => (
  <Svg>
    <rect x="3" y="2.5" width="10" height="11" rx="2" />
    <path d="M5.75 6h4.5M5.75 8.5h4.5M5.75 11h2.5" />
  </Svg>
);
export const CalendarIcon = () => (
  <Svg>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 6.75h11M5.5 2v2.5M10.5 2v2.5" />
  </Svg>
);
export const TodayIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </Svg>
);
export const FolderIcon = () => (
  <Svg>
    <path d="M2.5 5a1.5 1.5 0 0 1 1.5-1.5h2.4l1.4 1.5H12A1.5 1.5 0 0 1 13.5 6.5V11A1.5 1.5 0 0 1 12 12.5H4A1.5 1.5 0 0 1 2.5 11z" />
  </Svg>
);
export const TagIcon = () => (
  <Svg>
    <path d="M6.25 2.5L5 13.5M11 2.5L9.75 13.5M3 5.75h10.5M2.5 10.25H13" />
  </Svg>
);
export const TrashIcon = () => (
  <Svg>
    <path d="M3 4.5h10M6.25 4.5V3a.5.5 0 0 1 .5-.5h2.5a.5.5 0 0 1 .5.5v1.5M4.25 4.5l.5 8a1 1 0 0 0 1 1h4.5a1 1 0 0 0 1-1l.5-8" />
  </Svg>
);
export const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.25 10.25L13.5 13.5" />
  </Svg>
);
export const GearIcon = () => (
  <Svg>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75l.9 1.7 1.9-.45.45 1.9 1.7.9-.75 1.8.75 1.8-1.7.9-.45 1.9-1.9-.45-.9 1.7-.9-1.7-1.9.45-.45-1.9-1.7-.9.75-1.8-.75-1.8 1.7-.9.45-1.9 1.9.45z" />
  </Svg>
);
export const PlusIcon = () => (
  <Svg>
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </Svg>
);
export const KeyIcon = () => (
  <Svg>
    <circle cx="5.25" cy="10.75" r="2.5" />
    <path d="M7.1 8.9l5.65-5.65M10.5 5.5l1.75 1.75M12.25 3.75l1 1" />
  </Svg>
);
export const CopyIcon = () => (
  <Svg>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M3.5 10.5h-.25A1.25 1.25 0 0 1 2 9.25v-6A1.25 1.25 0 0 1 3.25 2h6A1.25 1.25 0 0 1 10.5 3.25v.25" />
  </Svg>
);
export const AlertIcon = () => (
  <Svg>
    <path d="M8 2.5l5.75 10.25H2.25z" />
    <path d="M8 6.75v2.75M8 11.25v.01" />
  </Svg>
);
