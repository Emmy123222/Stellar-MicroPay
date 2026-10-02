/**
 * components/ContactPickerModal.tsx
 * Address-book picker modal for the SendPaymentForm destination field
 * (Issue #1054).
 *
 * Lists all saved contacts (name + shortened address), searchable by name or
 * address. Selecting a contact returns it via `onSelect` — the parent fills
 * the destination field and closes the modal. Shows an empty state with a
 * link to the Contacts page when nothing is saved yet.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { loadContacts, type Contact } from "@/lib/contacts";
import { shortenAddress } from "@/lib/stellar";

interface ContactPickerModalProps {
  isOpen: boolean;
  onSelect: (contact: Contact) => void;
  onClose: () => void;
}

export default function ContactPickerModal({
  isOpen,
  onSelect,
  onClose,
}: ContactPickerModalProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  // Load contacts each time the modal opens so newly saved contacts appear.
  useEffect(() => {
    if (isOpen) {
      setContacts(loadContacts());
      setQuery("");
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q)
    );
  }, [contacts, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Address book"
      data-testid="contact-picker-modal"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-xl font-bold text-white">
            Address Book
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close address book"
            data-testid="contact-picker-close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or address..."
          aria-label="Search contacts"
          data-testid="contact-picker-search"
          className="input-field mb-4"
          autoFocus
        />

        {contacts.length === 0 ? (
          <div className="py-10 text-center" data-testid="contact-picker-empty">
            <ContactsIcon className="mx-auto mb-3 h-12 w-12 text-slate-600" />
            <p className="text-slate-400">No contacts saved yet.</p>
            <Link
              href="/contacts"
              data-testid="contact-picker-empty-link"
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-stellar-400 hover:text-stellar-300 transition-colors"
            >
              Go to Contacts
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center" data-testid="contact-picker-no-results">
            <p className="text-slate-400">
              No contacts match &ldquo;{query}&rdquo;.
            </p>
          </div>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="contact-picker-list">
            {filtered.map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => onSelect(contact)}
                  data-testid="contact-picker-option"
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {contact.name}
                    </span>
                    <span className="block font-mono text-xs text-slate-500">
                      {shortenAddress(contact.address, 8)}
                    </span>
                  </span>
                  <ArrowRightIcon className="h-4 w-4 shrink-0 text-slate-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ContactsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
    </svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}
