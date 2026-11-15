// Compare names the way a human would: ignore case, accents, order, punctuation.
const tokens = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort();

export const namesMatch = (a, b) => {
  const x = tokens(a), y = tokens(b);
  return x.length > 0 && x.length === y.length && x.every((t, i) => t === y[i]);
};
export const normName = (s) => tokens(s).join(' ');
