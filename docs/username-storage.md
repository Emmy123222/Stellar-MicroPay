# Username storage

The username registry is persisted in `backend/data/usernames.json` by default.
Writes use a process-specific temporary file followed by an atomic rename, and
the file is excluded from Git. Set `USERNAME_STORE_PATH` to a shared durable
volume in deployments with multiple backend replicas. The repository stores
normalized lowercase usernames and rejects duplicate usernames or public keys.

To migrate an existing in-memory deployment, stop writers, create the data
directory, and write an array of `{ "username": "...", "publicKey": "G..." }`
records to the configured path before starting the service. To roll back,
stop the service and restore the previous file from backup, or remove the file
to start with an empty registry. Do not delete the file while the service is
running because that would discard registrations on the next atomic write.
