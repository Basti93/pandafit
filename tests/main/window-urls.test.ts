import { sameApp } from '../../src/main/window-urls';

test('same page with other query or hash is the app', () => {
  expect(sameApp('file:///app/renderer/index.html?t=abc#film', 'file:///app/renderer/index.html?t=abc')).toBe(true);
  expect(sameApp('http://localhost:5173/#film', 'http://localhost:5173/?t=x')).toBe(true);
});
test('everything else is not', () => {
  expect(sameApp('https://evil.example/', 'http://localhost:5173/')).toBe(false);
  expect(sameApp('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
  expect(sameApp('file:///etc/passwd', 'file:///app/renderer/index.html')).toBe(false);
  expect(sameApp('nonsense', 'file:///app/renderer/index.html')).toBe(false);
});
