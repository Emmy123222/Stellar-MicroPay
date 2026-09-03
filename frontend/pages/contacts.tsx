/**
 * pages/contacts.tsx
 * Contacts page: save names mapped to Stellar addresses, lookup federation addresses.
 * Supports favouriting contacts and tagging them for quick filtering.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import WalletConnect from "@/components/WalletConnect";
import { isValidStellarAddress, resolveFederationAddress } from "@/lib/stellar";
import {
  type AddressBookContact,
  deleteAddressBookContact,
  getAllTags,
  loadAddressBookContacts,
  saveAddressBookContacts,
  subscribeToAddressBookContacts,
  toggleFavouriteContact,
  updateContactTags,
  upsertAddressBookContact,
} from "@/lib/addressBook";
import { copyToClipboard } from "@/utils/format";
import { useToast } from "@/lib/useToast";
import { useRouter } from "next/router";
import { useWallet } from "@/lib/useWallet";

export default function Contacts() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { showToast } = useToast();

  // Contact list
  const [contacts, setContacts] = useState<AddressBookContact[]>(loadAddressBookContacts);

  // Add/edit form
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Tag input inside the add/edit form
  const [tagInput, setTagInput] = useState("");
  const [formTags, setFormTags] = useState<string[]>([]);

  // Inline tag editing for an existing contact (id → current draft)
  const [inlineTagContactId, setInlineTagContactId] = useState<string | null>(null);
  const [inlineTagInput, setInlineTagInput] = useState("");

  // Active tag filter chip
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

  // Federation lookup
  const [federationInput, setFederationInput] = useState("");
  const [federationLoading, setFederationLoading] = useState(false);
  const [federationResult, setFederationResult] = useState<{
    address: string;
    federationAddress: string;
  } | null>(null);

  useEffect(() => subscribeToAddressBookContacts(setContacts), []);

  // ── Derived data ──────────────────────────────────────────────────────────

  const allTags = getAllTags(contacts);

  const favourites = contacts.filter((c) => c.favourite);
  const others = contacts.filter((c) => !c.favourite);

  /** Apply active tag filter across the full list while preserving section order */
  function filterByTag(list: AddressBookContact[]) {
    if (!activeTagFilter) return list;
    return list.filter((c) => c.tags?.includes(activeTagFilter));
  }

  const visibleFavourites = filterByTag(favourites);
  const visibleOthers = filterByTag(others);
  const totalVisible = visibleFavourites.length + visibleOthers.length;

  // ── Handlers ──────────────────────────────────────────────────────────────

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
      const existing = contacts.find((c) => c.id === editingId);
      const updatedAt = Date.now();
      const nextContacts = contacts.map((c) =>
        c.id === editingId ? { ...c, nickname: name.trim(), address, tags: formTags, updatedAt } : c
      );
      saveAddressBookContacts(nextContacts);
      setContacts(nextContacts);
      showToast("Contact updated");
      setEditingId(null);
    } else {
      setContacts(
        upsertAddressBookContact({ nickname: name, address, tags: formTags, favourite: false })
      );
      showToast("Contact saved");
    }

    setName("");
    setAddress("");
    setFormTags([]);
    setTagInput("");
  };

  const handleDeleteContact = (id: string) => {
    setContacts(deleteAddressBookContact(id));
    showToast("Contact deleted");
  };

  const handleEditContact = (contact: AddressBookContact) => {
    setEditingId(contact.id);
    setName(contact.nickname);
    setAddress(contact.address);
    setFormTags(contact.tags ?? []);
    setTagInput("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName("");
    setAddress("");
    setFormTags([]);
    setTagInput("");
  };

  const handleToggleFavourite = (id: string) => {
    setContacts(toggleFavouriteContact(id));
  };

  // Form tag helpers
  const handleAddFormTag = () => {
    const tag = tagInput.trim();
    if (tag && !formTags.includes(tag)) {
      setFormTags((prev) => [...prev, tag]);
    }
    setTagInput("");
  };

  const handleRemoveFormTag = (tag: string) => {
    setFormTags((prev) => prev.filter((t) => t !== tag));
  };

  // Inline tag editing for existing contacts
  const handleOpenInlineTags = (contact: AddressBookContact) => {
    setInlineTagContactId(contact.id);
    setInlineTagInput("");
  };

  const handleCloseInlineTags = () => {
    setInlineTagContactId(null);
    setInlineTagInput("");
  };

  const handleAddInlineTag = (contact: AddressBookContact) => {
    const tag = inlineTagInput.trim();
    if (!tag) return;
    const existingTags = contact.tags ?? [];
    if (!existingTags.includes(tag)) {
      const next = updateContactTags(contact.id, [...existingTags, tag]);
      setContacts(next);
    }
    setInlineTagInput("");
  };

  const handleRemoveInlineTag = (contact: AddressBookContact, tag: string) => {
    const next = updateContactTags(
      contact.id,
      (contact.tags ?? []).filter((t) => t !== tag)
    );
    setContacts(next);
  };

  // Federation lookup
  const handleFederationLookup = async () => {
    if (!federationInput.trim()) {
      showToast("Enter a federation address (user*domain.com)");
      return;
    }
    setFederationLoading(true);
    try {
      const resolvedAddress = await resolveFederationAddress(federationInput.trim());
      setFederationResult({ address: resolvedAddress, federationAddress: federationInput.trim() });
      showToast("Federation lookup successful");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Federation lookup failed");
      setFederationResult(null);
    } finally {
      setFederationLoading(false);
    }
  };

  const handleUseResolvedAddress = () => {
    if (!federationResult) return;
    setAddress(federationResult.address);
    setFederationInput("");
    setFederationResult(null);
    showToast("Address copied to form");
  };

  const handleSendXLM = (contact: AddressBookContact) => {
    router.push({ pathname: "/dashboard", query: { prefillDestination: contact.address } });
  };

  const handleCopyAddress = (addr: string) => {
    copyToClipboard(addr);
    showToast("Address copied");
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!publicKey) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 cursor-default select-none">
        <div className="text-center mb-10">
          <h1 className="font-display text-3xl font-bold text-white mb-3">Contacts</h1>
          <p className="text-slate-400">Connect your wallet to manage contacts</p>
        </div>
        <WalletConnect />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in cursor-default select-none">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-white mb-1">Contacts</h1>
        <p className="text-slate-400">Save and manage Stellar addresses</p>
      </div>

      <div className="space-y-8">
        {/* ── Add / Edit Contact Form ─────────────────────────────────────── */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PlusIcon className="w-5 h-5 text-stellar-400" />
            {editingId ? "Edit Contact" : "Add Contact"}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="label">Contact name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Alice, Daily Coffee"
                className="input-field"
              />
            </div>

            <div>
              <label className="label">Stellar address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="G... (56 character public key)"
                className="input-field"
              />
              {address.length > 0 && !isValidStellarAddress(address) && (
                <p className="mt-1 text-xs text-red-400">Invalid Stellar address</p>
              )}
            </div>

            {/* Tag input */}
            <div>
              <label className="label">Tags (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddFormTag();
                    }
                  }}
                  placeholder="e.g. exchange, family"
                  className="input-field flex-1"
                />
                <button
                  type="button"
                  onClick={handleAddFormTag}
                  disabled={!tagInput.trim()}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm disabled:opacity-40 transition-colors"
                >
                  Add
                </button>
              </div>
              {formTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {formTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-stellar-500/15 text-stellar-300 border border-stellar-500/20"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => handleRemoveFormTag(tag)}
                        className="hover:text-white ml-0.5"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <XSmallIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
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

        {/* ── Federation Lookup ───────────────────────────────────────────── */}
        <div className="card">
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <SearchIcon className="w-5 h-5 text-stellar-400" />
            Federation Lookup
          </h2>
          <div className="space-y-4">
            <div>
              <label className="label">Federation address</label>
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
              <p className="mt-1 text-xs text-slate-400">
                Resolve Stellar Federation addresses to public keys
              </p>
            </div>

            {federationResult && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <p className="text-sm text-slate-300 mb-2">Resolved address:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs bg-slate-950/50 p-2 rounded font-mono text-slate-300 break-all">
                    {federationResult.address}
                  </code>
                  <button
                    onClick={handleUseResolvedAddress}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    Use
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
                  Looking up...
                </>
              ) : (
                <>
                  <SearchIcon className="w-4 h-4" />
                  Resolve Address
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── Tag filter chips ────────────────────────────────────────────── */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">
              Filter:
            </span>
            <button
              onClick={() => setActiveTagFilter(null)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeTagFilter === null
                  ? "bg-stellar-500/20 border-stellar-500/40 text-stellar-300"
                  : "border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeTagFilter === tag
                    ? "bg-stellar-500/20 border-stellar-500/40 text-stellar-300"
                    : "border-slate-600 text-slate-400 hover:border-slate-500 hover:text-slate-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* ── Contacts list ───────────────────────────────────────────────── */}
        <div>
          <h2 className="font-display text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <ContactsIcon className="w-5 h-5 text-stellar-400" />
            Saved Contacts
            <span className="ml-auto text-sm font-normal text-slate-400">
              {totalVisible} {totalVisible === 1 ? "contact" : "contacts"}
              {activeTagFilter && (
                <span className="ml-1 text-stellar-400">· #{activeTagFilter}</span>
              )}
            </span>
          </h2>

          {totalVisible === 0 ? (
            <div className="card text-center py-12">
              <ContactsIcon className="w-12 h-12 mx-auto mb-3 text-slate-600" />
              <p className="text-slate-400">
                {activeTagFilter
                  ? `No contacts tagged "${activeTagFilter}".`
                  : "No contacts yet. Add one to get started."}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Favourites section */}
              {visibleFavourites.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-400/80 mb-2 flex items-center gap-1.5">
                    <StarFilledIcon className="w-3.5 h-3.5" />
                    Favourites
                  </p>
                  <div className="space-y-3">
                    {visibleFavourites.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        editingId={editingId}
                        inlineTagContactId={inlineTagContactId}
                        inlineTagInput={inlineTagInput}
                        onSetInlineTagInput={setInlineTagInput}
                        onToggleFavourite={handleToggleFavourite}
                        onEdit={handleEditContact}
                        onDelete={handleDeleteContact}
                        onCopy={handleCopyAddress}
                        onSend={handleSendXLM}
                        onOpenInlineTags={handleOpenInlineTags}
                        onCloseInlineTags={handleCloseInlineTags}
                        onAddInlineTag={handleAddInlineTag}
                        onRemoveInlineTag={handleRemoveInlineTag}
                        onFilterByTag={setActiveTagFilter}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Regular contacts */}
              {visibleOthers.length > 0 && (
                <div>
                  {visibleFavourites.length > 0 && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
                      Other Contacts
                    </p>
                  )}
                  <div className="space-y-3">
                    {visibleOthers.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        editingId={editingId}
                        inlineTagContactId={inlineTagContactId}
                        inlineTagInput={inlineTagInput}
                        onSetInlineTagInput={setInlineTagInput}
                        onToggleFavourite={handleToggleFavourite}
                        onEdit={handleEditContact}
                        onDelete={handleDeleteContact}
                        onCopy={handleCopyAddress}
                        onSend={handleSendXLM}
                        onOpenInlineTags={handleOpenInlineTags}
                        onCloseInlineTags={handleCloseInlineTags}
                        onAddInlineTag={handleAddInlineTag}
                        onRemoveInlineTag={handleRemoveInlineTag}
                        onFilterByTag={setActiveTagFilter}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Back link */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-stellar-400 hover:text-stellar-300 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────

interface ContactCardProps {
  contact: AddressBookContact;
  editingId: string | null;
  inlineTagContactId: string | null;
  inlineTagInput: string;
  onSetInlineTagInput: (v: string) => void;
  onToggleFavourite: (id: string) => void;
  onEdit: (c: AddressBookContact) => void;
  onDelete: (id: string) => void;
  onCopy: (addr: string) => void;
  onSend: (c: AddressBookContact) => void;
  onOpenInlineTags: (c: AddressBookContact) => void;
  onCloseInlineTags: () => void;
  onAddInlineTag: (c: AddressBookContact) => void;
  onRemoveInlineTag: (c: AddressBookContact, tag: string) => void;
  onFilterByTag: (tag: string | null) => void;
}

function ContactCard({
  contact,
  editingId,
  inlineTagContactId,
  inlineTagInput,
  onSetInlineTagInput,
  onToggleFavourite,
  onEdit,
  onDelete,
  onCopy,
  onSend,
  onOpenInlineTags,
  onCloseInlineTags,
  onAddInlineTag,
  onRemoveInlineTag,
  onFilterByTag,
}: ContactCardProps) {
  const isEditingThis = editingId === contact.id;
  const isTaggingThis = inlineTagContactId === contact.id;
  const tags = contact.tags ?? [];

  return (
    <div
      className={`card-hover p-4 rounded-xl border transition-all ${
        contact.favourite
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-slate-700/50 bg-slate-800/30"
      } ${isEditingThis ? "ring-1 ring-stellar-500/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: name + address */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-white">{contact.nickname}</h3>
            {contact.favourite && (
              <StarFilledIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            )}
          </div>
          <p className="text-xs text-slate-400 font-mono mt-1 break-all">{contact.address}</p>

          {/* Tags row */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => onFilterByTag(tag)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-stellar-500/10 text-stellar-400 border border-stellar-500/20 hover:bg-stellar-500/20 transition-colors"
                  title={`Filter by "${tag}"`}
                >
                  {tag}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveInlineTag(contact, tag);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        onRemoveInlineTag(contact, tag);
                      }
                    }}
                    className="hover:text-red-400 ml-0.5"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <XSmallIcon className="w-3 h-3" />
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Inline tag editor */}
          {isTaggingThis && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={inlineTagInput}
                onChange={(e) => onSetInlineTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddInlineTag(contact);
                  }
                  if (e.key === "Escape") onCloseInlineTags();
                }}
                placeholder="New tag…"
                autoFocus
                className="input-field text-sm py-1 flex-1"
              />
              <button
                type="button"
                onClick={() => onAddInlineTag(contact)}
                disabled={!inlineTagInput.trim()}
                className="px-3 py-1 rounded-lg bg-stellar-500/20 text-stellar-300 text-sm disabled:opacity-40 hover:bg-stellar-500/30 transition-colors"
              >
                Add
              </button>
              <button
                type="button"
                onClick={onCloseInlineTags}
                className="px-2 py-1 rounded-lg bg-slate-700 text-slate-400 text-sm hover:bg-slate-600 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {/* Favourite toggle */}
          <button
            onClick={() => onToggleFavourite(contact.id)}
            title={contact.favourite ? "Remove from favourites" : "Add to favourites"}
            className={`p-2 rounded-lg transition-colors ${
              contact.favourite
                ? "text-amber-400 bg-amber-400/10 hover:bg-amber-400/20"
                : "text-slate-500 hover:text-amber-400 hover:bg-amber-400/10"
            }`}
          >
            {contact.favourite ? (
              <StarFilledIcon className="w-4 h-4" />
            ) : (
              <StarOutlineIcon className="w-4 h-4" />
            )}
          </button>

          {/* Tag button */}
          <button
            onClick={() => (isTaggingThis ? onCloseInlineTags() : onOpenInlineTags(contact))}
            title="Edit tags"
            className={`p-2 rounded-lg transition-colors ${
              isTaggingThis
                ? "text-stellar-400 bg-stellar-500/10"
                : "text-slate-400 hover:text-stellar-400 hover:bg-stellar-500/10"
            }`}
          >
            <TagIcon className="w-4 h-4" />
          </button>

          {/* Copy */}
          <button
            onClick={() => onCopy(contact.address)}
            title="Copy address"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <CopyIcon className="w-4 h-4" />
          </button>

          {/* Send */}
          <button
            onClick={() => onSend(contact)}
            title="Send XLM to this contact"
            className="px-3 py-2 rounded-lg text-sm font-medium text-stellar-300 bg-stellar-500/10 border border-stellar-500/20 hover:bg-stellar-500/20 hover:border-stellar-500/30 transition-colors"
          >
            Send
          </button>

          {/* Edit */}
          <button
            onClick={() => onEdit(contact)}
            title="Edit contact"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <EditIcon className="w-4 h-4" />
          </button>

          {/* Delete */}
          <button
            onClick={() => onDelete(contact.id)}
            title="Delete contact"
            className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.5 5.5a7.5 7.5 0 0010.5 10.5z"
      />
    </svg>
  );
}

function ContactsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function StarFilledIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function StarOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
      />
    </svg>
  );
}

function TagIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 7h.01M3 3h7.5a2 2 0 011.414.586l7.5 7.5a2 2 0 010 2.828l-5.5 5.5a2 2 0 01-2.828 0l-7.5-7.5A2 2 0 013 10.5V3z"
      />
    </svg>
  );
}

function XSmallIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
