/** 작은 선 아이콘. 색은 currentColor, 크기는 글자에 맞춘다. 장식이므로 aria-hidden — 옆에 항상 텍스트가 있다. */
const base = { width: '1em', height: '1em', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export function LockIcon() {
  return (
    <svg {...base} className="icon">
      <rect x="3.25" y="7.25" width="9.5" height="6.5" rx="1.5" />
      <path d="M5.5 7.25V5.5a2.5 2.5 0 0 1 5 0v1.75" />
    </svg>
  );
}

export function PinIcon() {
  return (
    <svg {...base} className="icon">
      <path d="M9.5 2.5l4 4-2 .75-2.25 2.25.25 2.5-1 1-5-5 1-1 2.5.25L9.25 5z" />
      <path d="M5.5 10.5l-3 3" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base} className="icon">
      <path d="M9.5 3.5L5 8l4.5 4.5" />
    </svg>
  );
}
