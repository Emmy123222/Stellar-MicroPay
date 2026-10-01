/**
 * components/FloatingAssistantButton.tsx
 * Floating action button that opens the AI Payment Assistant (#610).
 */

export default function FloatingAssistantButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open AI payment assistant"
      title="AI Payment Assistant (⌘K)"
      className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-stellar-500 text-black shadow-2xl transition-all hover:scale-105 hover:bg-stellar-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-stellar-300 focus-visible:ring-offset-2 focus-visible:ring-offset-cosmos-900"
    >
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
        />
      </svg>
    </button>
  );
}
