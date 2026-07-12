/** Compact 14×14 currentColor icons for the map tool rails (match the Layers icon). */

const ICON_PROPS = {
  className: "map-tool-icon",
  width: 14,
  height: 14,
  viewBox: "0 0 14 14",
  "aria-hidden": true,
} as const;

export function IconRoute() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M3.6 1.6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6.8 6.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        fill="currentColor"
      />
      <path
        d="M5 5 9 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="0.5 2"
      />
    </svg>
  );
}

export function IconAnalysis() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M2.1 1.2v10.7h10.7"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5.4" cy="8.6" r="1.35" fill="currentColor" />
      <circle cx="8.1" cy="5.4" r="1.35" fill="currentColor" />
      <circle cx="11" cy="3" r="1.35" fill="currentColor" />
    </svg>
  );
}

export function IconData() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M1.8 2.4h10.4v9.2H1.8Zm0 3.1h10.4M1.8 8.6h10.4M6.3 2.4v9.2"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconFilter() {
  return (
    <svg {...ICON_PROPS}>
      <path
        d="M1.6 2h10.8L8.4 7.3v4.3L5.6 10V7.3L1.6 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function IconHelp() {
  return (
    <svg {...ICON_PROPS}>
      <circle
        cx="7"
        cy="7"
        r="5.6"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="none"
      />
      <path
        d="M5.35 5.55c0-.95.72-1.65 1.7-1.65.97 0 1.65.62 1.65 1.5 0 .68-.33 1.05-.9 1.44-.55.37-.73.62-.73 1.13v.25"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="7.05" cy="10.3" r="0.8" fill="currentColor" />
    </svg>
  );
}
