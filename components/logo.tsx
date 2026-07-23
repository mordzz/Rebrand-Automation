export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" role="img" className={className} xmlns="http://www.w3.org/2000/svg">
      <title>Noah Engine</title>
      <g fill="currentColor">
        <circle cx="32" cy="32" r="5" />
        <rect x="28.5" y="6" width="7" height="19.5" rx="3.5" />
        <rect x="28.5" y="6" width="7" height="19.5" rx="3.5" transform="rotate(120 32 32)" />
        <rect x="28.5" y="6" width="7" height="19.5" rx="3.5" transform="rotate(240 32 32)" />
        <g transform="rotate(60 32 32)">
          <rect x="30" y="6" width="4" height="4" rx="1" />
          <rect x="29.25" y="11.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="28.5" y="18.5" width="7" height="7" rx="2" />
        </g>
        <g transform="rotate(180 32 32)">
          <rect x="30" y="6" width="4" height="4" rx="1" />
          <rect x="29.25" y="11.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="28.5" y="18.5" width="7" height="7" rx="2" />
        </g>
        <g transform="rotate(300 32 32)">
          <rect x="30" y="6" width="4" height="4" rx="1" />
          <rect x="29.25" y="11.5" width="5.5" height="5.5" rx="1.5" />
          <rect x="28.5" y="18.5" width="7" height="7" rx="2" />
        </g>
      </g>
    </svg>
  );
}
