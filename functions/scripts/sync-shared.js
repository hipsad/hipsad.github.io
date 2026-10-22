// Cloud Functions only deploy this folder, so copy the shared game rules in before deploying.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'shared');
const dest = path.join(__dirname, '..', 'shared');
fs.mkdirSync(dest, { recursive: true });
for (const f of ['constants.js', 'prompts.js', 'game-logic.js']) fs.copyFileSync(path.join(src, f), path.join(dest, f));
console.log('Synced shared game logic into functions/shared');
