"use strict";

const contactService = require("../services/contactService");

function owner(req) {
  return req.user.publicKey;
}

function list(req, res) {
  res.json({ success: true, data: contactService.listContacts(owner(req)) });
}

function create(req, res, next) {
  try {
    res.status(201).json({ success: true, data: contactService.createContact(owner(req), req.body) });
  } catch (error) {
    next(error);
  }
}

function remove(req, res) {
  const removed = contactService.removeContact(owner(req), req.params.id);
  if (!removed) return res.status(404).json({ success: false, error: "Contact not found" });
  return res.status(204).send();
}

module.exports = { list, create, remove };
