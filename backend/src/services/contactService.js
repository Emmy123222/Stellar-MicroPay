"use strict";

const crypto = require("crypto");

const contactsByOwner = new Map();

function listContacts(owner) {
  return [...(contactsByOwner.get(owner) || [])];
}

function createContact(owner, input) {
  const contact = {
    id: crypto.randomUUID(),
    owner,
    name: String(input.name || "").trim(),
    publicKey: String(input.publicKey || "").trim(),
    createdAt: new Date().toISOString(),
  };
  if (!contact.name || !/^G[A-Z2-7]{55}$/.test(contact.publicKey)) {
    const error = new Error("name and a valid Stellar public key are required");
    error.status = 400;
    throw error;
  }
  const contacts = contactsByOwner.get(owner) || [];
  contacts.push(contact);
  contactsByOwner.set(owner, contacts);
  return contact;
}

function removeContact(owner, id) {
  const contacts = contactsByOwner.get(owner) || [];
  const next = contacts.filter((contact) => contact.id !== id);
  if (next.length === contacts.length) return false;
  contactsByOwner.set(owner, next);
  return true;
}

module.exports = { listContacts, createContact, removeContact };
