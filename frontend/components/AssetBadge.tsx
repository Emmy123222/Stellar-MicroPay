import React from 'react';
import clsx from 'clsx';

interface AssetBadgeProps {
  assetCode?: string;
  className?: string;
}

export function AssetBadge({ assetCode = 'XLM', className }: AssetBadgeProps) {
  const code = assetCode.toUpperCase();
  
  let colorClass = 'bg-slate-500/10 text-slate-400 border-slate-500/20'; // Other -> grey
  if (code === 'XLM') {
    colorClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20'; // XLM -> blue
  } else if (code === 'USDC') {
    colorClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'; // USDC -> green
  }

  return (
    <span className={clsx("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border tracking-wider", colorClass, className)}>
      {code}
    </span>
  );
}
