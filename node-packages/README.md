# Node packages

Place reviewed `cyrene.studio.nodes.v1` JSON manifests here, then explicitly
reload `/studio-catalog/v1/reload` as an administrator. Browser code is never
loaded from these packages. The control service validates the complete set
before publishing a revision and retains old versions for existing documents.

An execution adapter names a control-side configured provider; it is not a URL,
shell command, or authority to execute a task. A task image must be pinned by
SHA-256 digest. New task adapters must implement the versioned Product execution
boundary before the associated nodes can run.
