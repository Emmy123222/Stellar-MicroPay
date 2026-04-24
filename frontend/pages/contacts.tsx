/**
 * pages/contacts.tsx
 * Contacts page: save names mapped to Stellar addresses, lookup federation addresses.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import {
  shortenAddress,
  isValidStellarAddress,
  resolveFederationAddress,
} from "@/lib/stellar";
import { copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";
import { useRouter } from "next/router";
import clsx from "clsx";

interface Contact {
  id: string;
  name: string;
  address: string;
  createdAt: number;
}

interface ContactsProps {
  publicKey: string | null;
  onConnect: (pk: string) => void;
}

const STORAGE_KEY = "stellar-micropay-contacts";

export default function Contacts({ publicKey, onConnect }: ContactsProps) {
  const router = useRouter();
  const { visible: toastVisible, message: toastMessage, showToast } = useToast();

  // Contact management state
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Federation lookup state
  const [federationInput, setFederationInput] = useState("");
  const [federationLoading, setFederationLoading] = useState(false);
  const [federationResult, setFederationResult] = useState<{
    address: string;
    federationAddress: string;
  } | null>(null);

  // Load contacts from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setContacts(JSON.parse(stored));
      } catch (err) {
        console.error("Failed to load contacts:", err);
      }
    }
    setLoaded(true);
  }, []);

  // Save contacts to localStorage whenever they change
  useEffect(() => {
    if (loaded) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    }
  }, [contacts, loaded]);

  // Create or update a contact
  const handleSaveContact = () => {
    if (!name.trim() || !address.trim()) {
      showToast("Please enter both name and address");
      return;
    }

    if (!isValidStellarAddress(address)) {
      showToast("Invalid Stellar address");
      return;
    }

    if (editingId) {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === editingId ? { ...c, name: name.trim(), address } : c
        )
      );
      showToast("Contact updated");
      setEditingId(null);
    } else {
      const newContact: Contact = {
        id: Date.now().toString(),
        name: name.trim(),
        address,
        createdAt: Date.now(),
      };
      setContacts((prev) => [newContact, ...prev]);
      showToast("Contact saved");
    }

    setName("");
    setAddress("");
  };

  // Delete a contact
  const handleDeleteContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    showToast("Contact deleted");
  };

  // Start editing a contact
  const handleEditContact = (contact: Contact) => {
    setEditingId(contact.id);
    setName(contact.name);
    setAddress(contact.address);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingId(null);
    setName("");
    setAddress("");
  };

  // Resolve federation address
  const handleFederationLookup = async () => {
    if (!federationInput.trim()) {
      showToast("Enter a federation address (user*domain.com)");
      return;
    }

    setFederationLoading(true);
    try {
      const resolvedAddress = await resolveFederationAddress(
        federationInput.trim()
      );
      setFederationResult({
        address: resolvedAddress,
        federationAddress: federationInput.trim(),
      });
      showToast("Federation lookup successful");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Federation lookup failed"
      );
      setFederationResult(null);
    } finally {
      setFederationLoading(false);
    }
  };

  // Copy federation result to form
  const handleUseResolvedAddress = () => {
    if (!federationResult) return;
    setAddress(federationResult.address);
    setFederationInput("");
    setFederationResult(null);
    showToast("Address copied to form");
  };

  // Send XLM to a contact
  const handleSendXLM = (contact: Contact) => {
    router.push({
      pathname: "/dashboard",
      query: {
        prefillDestination: contact.address,
      },
    });
  };

  // Copy address to clipboard
  const handleCopyAddress = (addr: string) => {
    copyToClipboard(addr);
    showToast("Address copied");
  };

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">
            {`Contacts`}
          </h1>
          <p className="text-slate-400">{`Connect your wallet to manage contacts`}</p>
        </div>
        <WalletConnect onConnect={onConnect} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">
          {`Contacts`}
        </h1>
        <p className="text-slate-400">{`Save and manage Stellar addresses`}</p>
      </div>

      {/* Toast */}
      {toastVisible && (
        <div className="fixed bottom-4 right-4 z-50 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2.5 rounded-lg text-sm animate-fade-in">
          {toastMessage}
        </div>
      )}

      <div className="space-y-8">
        {/* Add/Edit Contact Form */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PlusIcon className="w-5 h-5 text-stellar-400" />
            {editingId ? "Edit Contact" : "Add Contact"}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="label">{`Contact name`}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Alice, Daily Coffee"
                className="input-field"
              />
            </div>

            <div>
              <label className="label">{`Stellar address`}</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="G... (56 character public key)"
                className="input-field"
              />
              {address.length > 0 && !isValidStellarAddress(address) && (
                <p className="mt-1 text-xs text-red-400">{`Invalid Stellar address`}</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveContact}
                disabled={!name.trim() || !address.trim()}
                className="btn-primary flex-1"
              >
                {editingId ? "Update Contact" : "Save Contact"}
              </button>
              {editingId && (
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Federation Lookup */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <SearchIcon className="w-5 h-5 text-stellar-400" />
            {`Federation Lookup`}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="label">{`Federation address`}</label>
              <input
                type="text"
                value={federationInput}
                onChange={(e) => setFederationInput(e.target.value)}
                placeholder="user*domain.com"
                className="input-field"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFederationLookup();
                }}
              />
              <p className="mt-1 text-xs text-slate-500">{`Resolve Stellar Federation addresses to public keys`}</p>
            </div>

            {federationResult && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-sm text-slate-300 mb-2">
                  {`Resolved address:`}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-slate-950/50 p-2 rounded font-mono text-slate-300 break-all">
                    {federationResult.address}
                  </code>
                  <button
                    onClick={handleUseResolvedAddress}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    {`Use`}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={handleFederationLookup}
              disabled={federationLoading || !federationInput.trim()}
              className="btn-primary w-full"
            >
              {federationLoading ? (
                <>
                  <Spinner />
                  {`Looking up...`}
                </>
              ) : (
                <>
                  <SearchIcon className="w-4 h-4" />
                  {`Resolve Address`}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Contacts List */}
        <div>
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ContactsIcon className="w-5 h-5 text-stellar-400" />
            {`Saved Contacts`}
            <span className="ml-auto text-sm font-normal text-slate-400">
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
            </span>
          </h2>

          {contacts.length === 0 ? (
            <div className="card text-center py-12">
              <ContactsIcon className="w-12 h-12 mx-auto mb-3 text-slate-600" />
              <p className="text-slate-400">{`No contacts yet. Add one to get started.`}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="card-hover p-4 rounded-xl border border-slate-700/50 bg-slate-800/30 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white">{contact.name}</h3>
                      <p className="text-xs text-slate-400 font-mono mt-1 break-all">
                        {contact.address}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Copy button */}
                      <button
                        onClick={() => handleCopyAddress(contact.address)}
                        title="Copy address"
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                      >
                        <CopyIcon className="w-4 h-4" />
                      </button>

                      {/* Send XLM button */}
                      <button
                        onClick={() => handleSendXLM(contact)}
                        title="Send XLM to this contact"
                        className="px-3 py-2 rounded-lg text-sm font-medium text-stellar-300 bg-stellar-500/10 border border-stellar-500/20 hover:bg-stellar-500/20 hover:border-stellar-500/30 transition-colors"
                      >
                        {`Send`}
                      </button>

                      {/* Edit button */}
                      <button
                        onClick={() => handleEditContact(contact)}
                        title="Edit contact"
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>

                      {/* Delete button */}
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        title="Delete contact"
                        className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Back to Dashboard */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-stellar-400 hover:text-stellar-300 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          {`Back to dashboard`}
        </Link>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0010.5 10.5z" />
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

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
