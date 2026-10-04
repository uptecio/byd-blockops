// Own-key validation also works on WebViews predating Object.hasOwn.
export const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
