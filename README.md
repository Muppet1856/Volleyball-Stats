# Volleyball Stats

This project exposes Volleyball statistics through a Cloudflare Worker that also serves the front-end assets located in the `public/` directory.

## Authentication

All `/api/*` endpoints require HTTP Basic authentication. The worker reads the expected username and password from the environment variables `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` that are provided by Cloudflare at runtime.

### Setting credentials in production

Deployments managed by Wrangler should provision the credentials as secrets. You can set or rotate the values with:

```bash
wrangler secret put BASIC_AUTH_USERNAME
wrangler secret put BASIC_AUTH_PASSWORD
```

Wrangler will prompt for the secret value and store it securely so that it is available to the worker during execution.

### Setting credentials for local development

When running the worker locally, create a `.dev.vars` file in the project root (the same directory as `wrangler.toml`) and provide the credentials as plain environment variables:

```dotenv
BASIC_AUTH_USERNAME=local-user
BASIC_AUTH_PASSWORD=local-pass
```

Wrangler automatically loads values from `.dev.vars` when you run `wrangler dev`, so the local worker enforces the same authentication check as production.

If either variable is omitted or left empty, the API routes will be left unprotected.
