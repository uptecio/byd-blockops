// Object.fromEntries is absent on the supported Android 8 Chrome 69 provider.
// Define own data properties, including __proto__, just as fromEntries does.
export function entriesObject(entries) {
  const result = {};
  for (const [key, value] of entries) Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  return result;
}
