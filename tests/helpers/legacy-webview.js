// Capability masking tests specific compatibility contracts, not a BYD GPU or
// an actual historic browser engine. Never install these hooks in production.
export async function emulateLegacyWebView(context) {
  await context.addInitScript(() => {
    Object.hasOwn = undefined;
    Element.prototype.replaceChildren = undefined;
    window.structuredClone = undefined;
    window.__legacyProbe = { arenaDraws: 0, contexts: [], lost: [] };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2') return null;
      const result = getContext.call(this, type, ...args);
      if (/webgl/.test(type)) {
        window.__legacyProbe.contexts.push({ id: this.id, type, available: !!result });
        this.addEventListener('webglcontextlost', () => window.__legacyProbe.lost.push(this.id));
      }
      return result;
    };
    for (const method of ['drawElements', 'drawArrays']) {
      const original = WebGLRenderingContext.prototype[method];
      WebGLRenderingContext.prototype[method] = function (...args) {
        if (this.canvas.id === 'arena') window.__legacyProbe.arenaDraws++;
        return original.apply(this, args);
      };
    }
  });
  await context.route('**/styles.css', async route => {
    const response = await route.fetch();
    // Engines that don't understand these declarations ignore them entirely;
    // preceding explicit edges and scalar fallback declarations must remain.
    const body = (await response.text()).replace(/([a-z-]+)\s*:\s*([^;{}]+)(;?)/gi,
      (declaration, property, value) => property === 'inset' || /\b(?:min|max|clamp)\(/.test(value) ? '' : declaration);
    await route.fulfill({ response, body });
  });
}
