import React from "react";

export function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function DraggableWidget({
  id,
  dragHandleLabel,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  children,
}: {
  id: string;
  dragHandleLabel: string;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-widget-id={id}
      className={`relative group rounded-2xl transition-opacity ${isDragging ? "opacity-40" : ""} ${
        isDragOver ? "ring-2 ring-stellar-400/60 ring-offset-2 ring-offset-cosmos-950 rounded-2xl" : ""
      }`}
    >
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
        aria-label={`Drag to reorder ${dragHandleLabel}`}
        className="absolute -top-2 right-2 z-10 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity bg-white/10 hover:bg-white/20 border border-white/10 rounded-full p-1.5"
      >
        <GripIcon className="w-4 h-4 text-slate-300" />
      </button>
      {children}
    </div>
  );
}
