import React from "react";

export function BubbleNotification({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div
      className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'
      }`}
    >
      <div className="bg-stellar-500 text-white px-4 py-2 rounded-lg shadow-lg max-w-xs">
        <p className="text-sm whitespace-nowrap overflow-hidden text-ellipsis">{message}</p>
      </div>
    </div>
  );
}
