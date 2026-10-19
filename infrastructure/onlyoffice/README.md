# DocumentServer configuration

DocumentServer is run from the pinned, unmodified image (see the ADR, `docs/adr/2026-10-17-onlyoffice-release-and-licence.md`). These files configure it without changing the image:

- **`local-production-linux.json`** is mounted read-only at `/etc/onlyoffice/documentserver/local-production-linux.json`. DocumentServer reads it after its generated `local.json`. It switches off the server-side AI feature, which 10.0 enables by default together with a browser proxy (ADR F4).
- The same file (EDIT-6.2) also sets:
  - `externalRequest.directIfIn`: `jwtToken: false` with `allowList: ["http://editor-api:3020/"]`. DocumentServer fetches directly only from the service's internal origin (the source route, legacy uploads, callbacks); every other URL goes through its private-address filter, so a signed configuration can no longer reach a private address (ADR F3, defence in depth behind the service's own checks). The API must answer on `editor-api` in every deployment, and outside `EDITOR_ENV=local` it refuses to start with any other `API_INTERNAL_URL`.
  - `FileConverter.converter.maxprocesscount`: 2 instead of 1, chosen for resilience, not measured: a wedged slot (ADR F17) no longer stops every conversion and editor open on its own. EDIT-6.4 measured memory, not this value.
- **`PLUGINS_ENABLED=false`**, set in the compose environment, stops the entrypoint's plugin manager. Without it, the manager downloads and installs ten third-party plugins from the OnlyOffice marketplace at every start (ADR F5). The editor profiles also disable the Plugin Manager in the browser (`editorConfig.plugins.disable`).

Do not add settings here that change DocumentServer's licence notices or About entry. The licence's additional terms require them (ADR, licence posture).
