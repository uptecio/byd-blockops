import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Catches unreadable names when a high-resolution canvas is reduced by CSS,
// clipped labels, labels obscuring markers, HTML names, and stale marker pixels.
const bundle = await build({
  stdin: { contents: 'import * as map from "./src/teammate-map.js"; window.mapFixture = map;', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'iife',
});
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.setContent('<canvas id="map" width="600" height="600"></canvas>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const cssSize of [600, 300, 200]) {
    const result = await page.evaluate(cssSize => {
      const canvas = document.getElementById('map');
      canvas.style.width = canvas.style.height = `${cssSize}px`;
      const context = canvas.getContext('2d');
      const { teammateMapState, drawTeammateMap, projectTeammateMapPosition } = window.mapFixture;
      const actor = (id, x, z, name = id) => ({ id, name, x, z, yaw: 0, alive: true, teamId: 'red' });
      const state = teammateMapState({ mapId: 'courtyard', modeId: 'tdm', selfId: 'self', actors: [
        actor('self', 0, 0, 'You'), actor('edge', 21, 21, 'EdgeFriend'), actor('safe', -21, -21, '<svg>'), actor('close', 8, 2, 'Ally'),
      ] });
      const texts = [];
      const fillText = context.fillText;
      // Observe actual text rendering while retaining the native canvas operation.
      context.fillText = function (text, x, y, ...args) {
        const metrics = this.measureText(text);
        texts.push({ text, fontSize: parseFloat(this.font.match(/([\d.]+)px/)[1]),
          left: x - metrics.actualBoundingBoxLeft, right: x + metrics.actualBoundingBoxRight,
          top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent });
        return fillText.call(this, text, x, y, ...args);
      };
      drawTeammateMap(canvas, state, { names: true });
      context.fillText = fillText;
      const pixels = context.getImageData(0, 0, 600, 600).data;
      const hasColorNear = (point, color) => {
        for (let y = Math.max(0, Math.floor(point.y - 45)); y < Math.min(600, point.y + 45); y++) {
          for (let x = Math.max(0, Math.floor(point.x - 45)); x < Math.min(600, point.x + 45); x++) {
            const offset = (y * 600 + x) * 4;
            if (color.every((value, index) => pixels[offset + index] === value) && pixels[offset + 3] === 255) return true;
          }
        }
        return false;
      };
      const colors = state.markers.map(marker => hasColorNear(
        projectTeammateMapPosition('courtyard', marker.x, marker.z, 600),
        marker.kind === 'self' ? [255, 228, 92] : [85, 184, 255],
      ));
      const edgeCenters = { 600: [[575, 575], [25, 25]], 300: [[570, 570], [30, 30]], 200: [[555, 555], [45, 45]] }[cssSize];
      const centers = [...edgeCenters, [405, 327]].map(([x, y]) => {
        const offset = (y * 600 + x) * 4;
        return Array.from(pixels.slice(offset, offset + 4));
      });
      drawTeammateMap(canvas, { ...state, markers: [] }, { names: true });
      const empty = context.getImageData(0, 0, 600, 600).data;
      let oldMarkers = 0;
      for (let offset = 0; offset < empty.length; offset += 4) {
        if (empty[offset] === 255 && empty[offset + 1] === 228 && empty[offset + 2] === 92
          || empty[offset] === 85 && empty[offset + 1] === 184 && empty[offset + 2] === 255) oldMarkers++;
      }
      drawTeammateMap(canvas, { ...state, visible: false });
      const cleared = context.getImageData(0, 0, 600, 600).data;
      return { texts, colors, centers, oldMarkers, transparent: cleared.every(value => value === 0), images: document.querySelectorAll('svg,img').length };
    }, cssSize);
    assert.equal(result.texts.length, 4, `${cssSize}px canvas shows all four names`);
    for (const text of result.texts) {
      assert.ok(text.fontSize * cssSize / 600 >= 12, `${cssSize}px canvas name ${text.text} remains at least 12 CSS px`);
      assert.ok(text.left >= 0 && text.top >= 0 && text.right <= 600 && text.bottom <= 600, `${cssSize}px canvas name ${text.text} remains inside`);
    }
    assert.ok(result.texts.some(text => text.text === '<svg>'), 'HTML-like friendly name is painted as literal text');
    assert.equal(result.images, 0);
    assert.deepEqual(result.colors, [true, true, true, true], `${cssSize}px canvas labels preserve yellow self and blue teammate markers`);
    assert.deepEqual(result.centers, [[85, 184, 255, 255], [85, 184, 255, 255], [85, 184, 255, 255]], `${cssSize}px canvas labels leave all blue teammate centers unobscured`);
    assert.equal(result.oldMarkers, 0, 'empty roster removes all prior markers');
    assert.equal(result.transparent, true, 'hidden map clears all prior pixels');
    console.log(`PASS real canvas at ${cssSize}px: readable safe names, contained labels, visible markers, and clear`);
  }
  for (const [cssSize, positions] of [
    [300, [[0, 0], [0, -.5], [0, .5]]],
    [300, [[0, 0], [.5, 0], [1, 0], [1.5, 0], [2, 0]]],
    [200, [[0, 0], [.5, 0], [1, 0], [1.5, 0], [2, 0]]],
  ]) {
    const result = await page.evaluate(({ cssSize, positions }) => {
      const canvas = document.getElementById('map');
      canvas.style.width = canvas.style.height = `${cssSize}px`;
      const context = canvas.getContext('2d');
      const { teammateMapState, drawTeammateMap } = window.mapFixture;
      const state = teammateMapState({ mapId: 'courtyard', modeId: 'tdm', selfId: 'Ally0', actors: positions.map(([x, z], index) => ({
        id: `Ally${index}`, name: `Ally${index}`, x, z, yaw: 0, alive: true, teamId: 'red',
      })) });
      const texts = [];
      const fillText = context.fillText;
      context.fillText = function (text, x, y, ...args) {
        const metrics = this.measureText(text);
        texts.push({ text, fontSize: parseFloat(this.font.match(/([\d.]+)px/)[1]),
          left: x - metrics.actualBoundingBoxLeft, right: x + metrics.actualBoundingBoxRight,
          top: y - metrics.actualBoundingBoxAscent, bottom: y + metrics.actualBoundingBoxDescent });
        return fillText.call(this, text, x, y, ...args);
      };
      drawTeammateMap(canvas, state, { names: true });
      context.fillText = fillText;
      const pixels = context.getImageData(0, 0, 600, 600).data;
      let yellow = 0, blue = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] === 255 && pixels[offset + 1] === 228 && pixels[offset + 2] === 92) yellow++;
        if (pixels[offset] === 85 && pixels[offset + 1] === 184 && pixels[offset + 2] === 255) blue++;
      }
      return { texts, yellow, blue };
    }, { cssSize, positions });
    assert.deepEqual(result.texts.map(text => text.text).sort(), positions.map((_, index) => `Ally${index}`), `${cssSize}px clustered actors all retain readable names`);
    for (const [index, text] of result.texts.entries()) {
      assert.ok(text.fontSize * cssSize / 600 >= 12 && text.left >= 0 && text.top >= 0 && text.right <= 600 && text.bottom <= 600, 'clustered name is readable and inside canvas');
      for (const other of result.texts.slice(index + 1)) {
        assert.ok(text.right <= other.left || other.right <= text.left || text.bottom <= other.top || other.bottom <= text.top, 'clustered names do not cover each other');
      }
    }
    assert.ok(result.yellow > 0, 'nearby teammates cannot erase the yellow self arrow');
    assert.ok(result.blue > 0, 'nearby teammates keep visible blue dots');
    console.log(`PASS real canvas at ${cssSize}px: ${positions.length} clustered names and self arrow remain visible`);
  }
} finally {
  await browser.close();
}
