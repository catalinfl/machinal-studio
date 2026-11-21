import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareText, validateText } from './text.mjs';

test('text dimensions match editor presets, including classic 4k', () => {
  const input = { textItems: [], textRenderKey: 'a'.repeat(64), output: { resolution: '480p', aspect: 'landscape' } };
  assert.deepEqual(validateText(input), { width: 854, height: 480, aspect: 'landscape' });
  input.output = { resolution: '4k', aspect: 'classic' };
  assert.deepEqual(validateText(input), { width: 3840, height: 2880, aspect: 'classic' });
  input.output = { resolution: '1080p', aspect: 'portrait' };
  assert.deepEqual(validateText(input), { width: 1080, height: 1920, aspect: 'portrait' });
  assert.throws(() => validateText({ ...input, textRenderKey: 'invalid' }));
});

test('native browser prepares styled Unicode text without a web editor', { skip: !process.env.SCENE_BROWSER }, async () => {
  const input = { textRenderKey: 'a'.repeat(64), output: { resolution: '480p', aspect: 'landscape' }, textItems: [{
    id: 'title', text: 'Salut ăâîșț </script>', start: 0, duration: 2, x: 960, y: 540,
    fontFamily: 'montserrat', fontSize: 64, fontWeight: 700, italic: false, align: 'center', color: '#ffffff',
    strokeColor: '#000000', strokeWidth: 2, backgroundColor: '#000000', backgroundOpacity: 0.5,
    backgroundPadding: 12, backgroundRadius: 8, opacity: 1, rotation: 8, bannerStyle: 'none', accentColor: '#ffffff',
    animation: 'none', animationDuration: 0, isCaption: false, highlightMode: 'none', words: [],
  }] };
  const result = await prepareText(input);
  assert.equal(result.key, input.textRenderKey);
  assert.equal(result.overlays.length, 1);
  assert.equal(result.overlays[0].duration, 2);
  assert.equal(result.layout[0].text, input.textItems[0].text);
  assert.equal(result.layout[0].fontFamily, 'montserrat');
  assert.equal(Buffer.from(result.overlays[0].image, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('FHD Romanian left-anchored titles preserve exact coordinates and embedded serif fonts', { skip: !process.env.SCENE_BROWSER, timeout: 120000 }, async () => {
  const item = {
    id: 'titlu-șț', text: 'Mihai Eminescu — Știință și creație', start: 0, duration: 3,
    x: 150, y: 370, anchor: 'left', fontFamily: 'merriweather', fontSize: 70, fontWeight: 700,
    italic: true, align: 'left', color: '#ffffff', strokeColor: '#000000', strokeWidth: 0,
    backgroundColor: '#000000', backgroundOpacity: 0, backgroundPadding: 0, backgroundRadius: 0,
    opacity: 1, rotation: 0, bannerStyle: 'none', animation: 'none', animationDuration: 0,
    isCaption: false, highlightMode: 'none', words: [],
  };
  const result = await prepareText({ textRenderKey: 'c'.repeat(64), output: { resolution: '1080p', aspect: 'landscape' }, textItems: [item] });
  assert.equal(result.layout[0].text, item.text);
  assert.equal(result.layout[0].id, item.id);
  assert.equal(result.layout[0].fontSize, 70);
  assert.equal(result.overlays[0].x, 150);
  const png = Buffer.from(result.overlays[0].image, 'base64');
  assert.ok(result.overlays[0].x + png.readUInt32BE(16) <= 1920);
});

test('portrait word captions finish native serialization and stay inside the safe area', { skip: !process.env.SCENE_BROWSER, timeout: 120000 }, async () => {
  const words = ['Călătorind', 'printre', 'asteroizi,', 'descoperim'];
  const style = {
    x: 540, y: 1530, fontFamily: 'montserrat', fontSize: 64, fontWeight: 700,
    italic: false, align: 'center', color: '#ffffff', strokeColor: '#101D2F', strokeWidth: 3,
    backgroundColor: '#101D2F', backgroundOpacity: 0.85, backgroundPadding: 20, backgroundRadius: 12,
    opacity: 1, rotation: 0, bannerStyle: 'none', accentColor: '#ffffff', animation: 'none', animationDuration: 0,
    isCaption: true, highlightMode: 'word', highlightColor: '#EBC36B', highlightBackgroundColor: '#000000',
    highlightBackgroundOpacity: 0, highlightAnimation: 'none',
  };
  const textItems = Array.from({length: 30}, (_, index) => ({
    ...style, id: `caption-${index}`, text: words.join(' '), start: index * 2, duration: 2,
    words: words.map((text, index) => ({text, start: index * 0.5, end: (index + 1) * 0.5})),
  }));
  const result = await prepareText({ textRenderKey: 'b'.repeat(64), output: {resolution: '1080p', aspect: 'portrait'}, textItems });
  assert.equal(result.overlays.length, 120);
  for (const overlay of result.overlays) {
    const png = Buffer.from(overlay.image, 'base64');
    const width = png.readUInt32BE(16);
    assert.ok(overlay.x >= 0 && overlay.x + width <= 1080, `caption clipped: ${overlay.x} + ${width}`);
  }
});

test('MCP caption rasters keep highlights and cover every frame after API microsecond serialization', { skip: !process.env.SCENE_BROWSER, timeout: 120000 }, async () => {
  const textItems = ['pop', 'none'].map((highlightAnimation, index) => ({
    id: `continuous-${index}`, text: 'Fără întreruperi', start: index + 0.000017, duration: 0.9,
    x: 960, y: 800, fontFamily: 'montserrat', fontSize: 64, fontWeight: 700,
    italic: false, align: 'center', color: '#ffffff', strokeColor: '#000000', strokeWidth: 2,
    backgroundColor: '#000000', backgroundOpacity: 0, backgroundPadding: 0, backgroundRadius: 0,
    opacity: 1, rotation: 0, bannerStyle: 'none', animation: 'none', animationDuration: 0,
    isCaption: true, highlightMode: 'word', highlightColor: '#000000',
    highlightBackgroundColor: '#ffff00', highlightBackgroundOpacity: 1, highlightAnimation,
    words: [{ text: 'Fără', start: 0, end: 0.3 }, { text: 'întreruperi', start: 0.305, end: 0.66 }],
  }));
  const original = JSON.stringify(textItems);
  const result = await prepareText({ textRenderKey: 'd'.repeat(64), output: { resolution: '480p', aspect: 'landscape' }, textItems });
  assert.equal(JSON.stringify(textItems), original);
  assert.equal(result.overlays.length, 18);
  for (const item of textItems) {
    const overlays = result.overlays.filter(overlay => overlay.start >= item.start && overlay.start < item.start + item.duration);
    const intervals = overlays.map(({ start, duration }) => ({ start: Math.round(start * 1e6), duration: Math.round(duration * 1e6) }));
    assert.equal(intervals[0].start, Math.round(item.start * 1e6));
    assert.equal(intervals.at(-1).start + intervals.at(-1).duration, Math.round((item.start + item.duration) * 1e6));
    for (let index = 1; index < intervals.length; index++) {
      assert.equal(intervals[index].start, intervals[index - 1].start + intervals[index - 1].duration);
    }
    for (const fps of [24, 25, 30, 60]) {
      const ranges = intervals.map(({ start, duration }) => ({
        start: Math.ceil(start / 1e6 * fps - 1e-9), end: Math.ceil((start + duration) / 1e6 * fps - 1e-9),
      }));
      for (let frame = Math.ceil(item.start * fps - 1e-9); frame < Math.ceil((item.start + item.duration) * fps - 1e-9); frame++) {
        assert.equal(ranges.filter(({ start, end }) => frame >= start && frame < end).length, 1, `${fps} fps, frame ${frame}`);
      }
    }
    if (item.highlightAnimation === 'none') {
      assert.equal(overlays.length, 2);
      assert.equal(intervals[0].duration, 305000);
      assert.notEqual(overlays[0].image, overlays[1].image);
    }
  }
});
