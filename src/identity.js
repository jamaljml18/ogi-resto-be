function identityPart(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID');
}
// Anchored, escaped literal regex avoids LIKE wildcard aliases in company/division values.
function exactIdentityPattern(value) {
  const special = new Set('\\.^$*+?()[]{}|');
  const escaped = Array.from(String(value || '').trim(), char => special.has(char) ? '\\' + char : char).join('');
  return '^' + escaped + '$';
}
module.exports = { identityPart, exactIdentityPattern };
