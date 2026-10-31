// aapt2 37 emits namespace-qualified literal booleans; older versions emit typed hex.
// Read only direct application attributes, so a child component cannot satisfy policy.
function androidApplicationBoolean(tree, name) {
  const ids = { usesCleartextTraffic: '010104ec', debuggable: '0101000f' };
  if (!ids[name] || typeof tree !== 'string') return undefined;
  const lines = tree.split(/\r?\n/);
  const applications = lines.flatMap((line, index) => /^\s*E:\s+application(?:\s|$)/.test(line) ? [index] : []);
  if (applications.length !== 1) return undefined;
  const start = applications[0];
  const indent = lines[start].match(/^\s*/)[0].length;
  const attributes = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*E:/.test(line)) break;
    if (line.match(/^\s*/)[0].length === indent + 2 && /^\s*A:/.test(line)) attributes.push(line);
  }
  const pattern = new RegExp(`^\\s*A:\\s+(?:android:|http://schemas\\.android\\.com/apk/res/android:)${name}(?:\\(0x${ids[name]}\\))?\\s*=\\s*(?:(true|false)|\\(type 0x12\\)0x([0-9a-f]+))\\s*$`, 'i');
  const matches = attributes.flatMap(line => line.match(pattern) ? [line.match(pattern)] : []);
  if (matches.length !== 1) return undefined;
  return matches[0][1] ? matches[0][1].toLowerCase() === 'true' : parseInt(matches[0][2], 16) !== 0;
}

module.exports = { androidApplicationBoolean };
