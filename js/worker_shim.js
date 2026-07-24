// worker_shim.js — the vendored UMD libraries (opentype.js, clipper, earcut) attach
// themselves to `window`; give the worker a window alias BEFORE they are imported.
// (Side-effect imports evaluate in listed order, so import this module first.)
if (typeof window === 'undefined') {
  self.window = self;
  self.document = undefined; // font.js guards FontFace/document usage
}
