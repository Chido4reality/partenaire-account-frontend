// MP-APPROVAL-FULL-DETAIL — ONE wording for every transfer count summary.
//
// The old phrasing was "Move 18 units across 3 items". To a shop owner "units" and
// "items" read as the same word, so the line said nothing: it hid the distinction
// between how many DISTINCT PRODUCTS are moving and how many PIECES in total.
// We now always say "products" (distinct lines) and "pieces" (total quantity),
// which stay distinct in both English and French.
//
// Every surface that summarises a transfer count must use this helper rather than
// rolling its own string, so the two can never drift apart again.

// Counts a transfer's item lines defensively: a missing, null or non-numeric
// quantity contributes 0 rather than producing NaN in the boss's face.
export function transferCounts(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const products = arr.length;
  const pieces = arr.reduce((sum, it) => sum + (Number(it && it.quantity) || 0), 0);
  return { products, pieces };
}

// en=true  → "18 pieces across 3 products"   (short: "3 products · 18 pieces")
// en=false → "18 pièces sur 3 produits"      (short: "3 produits · 18 pièces")
export function transferCountLabel(lines, en, { short = false } = {}) {
  const { products, pieces } = transferCounts(lines);
  const pieceWord = en ? `piece${pieces === 1 ? "" : "s"}` : `pièce${pieces === 1 ? "" : "s"}`;
  const productWord = en ? `product${products === 1 ? "" : "s"}` : `produit${products === 1 ? "" : "s"}`;
  if (short) return `${products} ${productWord} · ${pieces} ${pieceWord}`;
  return en
    ? `${pieces} ${pieceWord} across ${products} ${productWord}`
    : `${pieces} ${pieceWord} sur ${products} ${productWord}`;
}
