These DER files are public, local-only conformance fixtures. The server key is a
test key, never a production identity. The CA signing key was not persisted.
The ECDSA P-256 server certificate is signed by the fixture CA, valid 2020–2040,
and has only the DNS SAN `localhost`. Tests exercise trust and hostname failures
without disabling certificate verification or requiring an external TLS service.
