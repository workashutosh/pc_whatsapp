/**
 * Evolution v2.2.3 rejects sendText to @lid chats because Baileys onWhatsApp
 * returns exists:false. Upstream fix (#2544) whitelists @lid the same way as
 * @broadcast. Patch the runtime bundles (dist/main.js) without upgrading
 * (2.4+ requires a license).
 */
const fs = require("fs");

const files = [
  "dist/main.js",
  "dist/main.mjs",
  "dist/api/integrations/channel/whatsapp/whatsapp.baileys.service.js",
];

const replacements = [
  [
    '&&!n.jid.includes("@broadcast")&&!n.jid.includes("@lid")',
    '&&!n.jid.includes("@broadcast")',
    '&&!n.jid.includes("@broadcast")&&!n.jid.includes("@lid")',
  ],
  [
    '&&!s.jid.includes("@broadcast")&&!s.jid.includes("@lid")',
    '&&!s.jid.includes("@broadcast")',
    '&&!s.jid.includes("@broadcast")&&!s.jid.includes("@lid")',
  ],
];

let anyChanged = false;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let source = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const [already, from, to] of replacements) {
    if (source.includes(already)) continue;
    if (!source.includes(from)) continue;
    source = source.split(from).join(to);
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(file, source);
    anyChanged = true;
    console.log("Evolution LID patch applied:", file);
  } else if (replacements.some(([already]) => source.includes(already))) {
    console.log("Evolution LID patch already present:", file);
  }
}

if (!anyChanged) {
  console.log("Evolution LID patch: no file changes needed");
}
