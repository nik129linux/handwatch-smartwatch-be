# Testing — read before verifying anything

1. **Scripted acceptance** (regression gate, run after every change):
   `node tests/acceptance.js` from this directory. Import Playwright by absolute path:
   `const { chromium } = require('/home/nico/.nvm/versions/node/v22.23.2/lib/node_modules/playwright');`
   Load pages with `pathToFileURL(path.resolve('index.html'))`.

2. **playwright-cli** (interactive exploration; state goes to disk):
   ```bash
   python3 -m http.server 8766 &
   playwright-cli -s=watch open http://localhost:8766/
   playwright-cli -s=watch snapshot
   playwright-cli -s=watch click e12
   playwright-cli -s=watch screenshot
   playwright-cli -s=watch close; kill %1
   ```
   Config: `.playwright/cli.config.json` points to the bundled Chromium.
   Turn every bug you find into an assertion in `tests/acceptance.js`.

Stay inside this directory. Do not read or glob the parent folder.
