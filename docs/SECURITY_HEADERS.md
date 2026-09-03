# Frontend security headers

The frontend is a Next.js static export. Next.js `headers()` configuration is
not emitted into static files, so production headers must be added by the HTTP
server that returns those files.

Both supported production paths enforce the same policy:

- `nginx/nginx.conf` covers the Compose edge proxy.
- `frontend/nginx.conf` is copied into the standalone frontend image by
  `frontend/Dockerfile.prod`.

After deploying, verify the actual public response rather than only inspecting
configuration:

```bash
cd frontend
npm run check:security-headers -- https://your-deployment.example
```

The command follows redirects, rejects unsuccessful responses, and fails when
required headers or critical CSP directives are missing. Run it against the
final HTTPS URL so CDN, load-balancer, and proxy behavior is included.

`next dev` is intentionally different: it does not use Nginx and does not add
the production policy because Next development tooling requires behavior that
the production CSP restricts. Local production verification should build the
Docker image, publish a port, then run the same checker against that URL.

The header policy is network-neutral: testnet and mainnet selection changes
Stellar endpoints but not browser security headers. Review CSP `connect-src`
when narrowing allowed Horizon or API origins.
