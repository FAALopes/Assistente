// Outlook-style arrows: purple reply / reply all, blue forward
const svg = (color: string, children: React.ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const ReplyIcon = () => svg('#a33fc4', <><path d="M6.5 3.5 2.5 7.5l4 4" /><path d="M2.5 7.5h6a5 5 0 0 1 5 5" /></>);
export const ReplyAllIcon = () => svg('#a33fc4', <><path d="M5 3.5 1 7.5l4 4" /><path d="M8.5 3.5 4.5 7.5l4 4" /><path d="M4.5 7.5h5a5 5 0 0 1 5 5" /></>);
export const ForwardIcon = () => svg('#1677ff', <><path d="M9.5 3.5l4 4-4 4" /><path d="M13.5 7.5h-11" /></>);
