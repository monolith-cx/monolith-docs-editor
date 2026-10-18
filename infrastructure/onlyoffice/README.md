# DocumentServer configuration

DocumentServer is run from the pinned, unmodified image (see the ADR, `docs/adr/2026-10-17-onlyoffice-release-and-licence.md`). These files configure it without changing the image:

- **`local-production-linux.json`** is mounted read-only at `/etc/onlyoffice/documentserver/local-production-linux.json`. DocumentServer reads it after its generated `local.json`. It switches off the server-side AI feature, which 10.0 enables by default together with a browser proxy (ADR F4).
- **`PLUGINS_ENABLED=false`**, set in the compose environment, stops the entrypoint's plugin manager. Without it, the manager downloads and installs ten third-party plugins from the OnlyOffice marketplace at every start (ADR F5). The editor profiles also disable the Plugin Manager in the browser (`editorConfig.plugins.disable`).

Do not add settings here that change DocumentServer's licence notices or About entry. The licence's additional terms require them (ADR, licence posture).
