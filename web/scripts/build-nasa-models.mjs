// Builds the in-game 3D models from NASA's official 3D resources
// (https://science.nasa.gov/3d-resources/, mirrored on GitHub) into small,
// meshopt-compressed GLBs under public/models/nasa/. Run: npm run models.
//
// The Apollo LM is split into its descent and ascent stages *before*
// optimising, so the return rocket can lift its ascent stage off the pad.

import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dedup, flatten, getBounds, join, prune, quantize, reorder, simplify, textureCompress, weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

const SRC = 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/';
const OUT = new URL('../public/models/nasa/', import.meta.url).pathname;

/**
 * Raw LM units (≈ metres): nodes whose lowest point is at or above this belong
 * to the ascent stage. The interface is fuzzy (2.13–2.41), so a few source
 * groups that straddle it are kept whole with the descent stage.
 */
const LM_STAGE_SPLIT_Y = 2.15;
const LM_DESCENT_GROUPS = new Set(['group31', 'group73', 'group74']); // descent deck + interstage fittings
const isAscent = (node) => !LM_DESCENT_GROUPS.has(node.getName().split(' ')[0]) && getBounds(node).min[1] >= LM_STAGE_SPLIT_Y;

const SOURCES = {
  lm: 'Apollo%20Lunar%20Module/Apollo%20Lunar%20Module.glb',
  perseverance: 'Mars%202020%20Perseverance%20Rover/Mars%202020%20Perseverance%20Rover.glb',
  hdu: 'Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%201).glb',
  insight: 'InSight%20Cruise%20Lander/InSight%20Cruise%20Lander%20(panels%20deployed).glb',
  hdu2: 'Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%202).glb',
  tank: 'Space%20Shuttle%20Parts/External%20tank.glb',
};

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(), // NASA's LM ships Draco-compressed
  });

async function download(name) {
  const dir = await mkdtemp(joinPath(tmpdir(), `nasa-${name}-`));
  const res = await fetch(SRC + SOURCES[name]);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const path = joinPath(dir, `${name}.glb`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

function triangles(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      n += Math.floor((idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3);
    }
  }
  return n;
}

/** Keep only the named node and its children, as the scene's single root at its world placement. */
function keepSubtree(doc, name) {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name);
  if (!node) throw new Error(`no node named ${name}`);
  const world = node.getWorldMatrix();
  node.getParentNode()?.removeChild(node);
  node.setMatrix(world);
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) scene.removeChild(child);
    scene.addChild(node);
  }
  for (const n of doc.getRoot().listNodes()) {
    let p = n;
    while (p && p !== node) p = p.getParentNode();
    if (!p) n.dispose();
  }
}

/** Keep only the mesh nodes for which keep(node) is true. */
function keepNodes(doc, keep) {
  let kept = 0;
  let dropped = 0;
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    if (keep(node)) kept++;
    else { node.dispose(); dropped++; }
  }
  return { kept, dropped };
}

async function optimise(doc, { textureSize, ratio = 1, error = 0.0005, merge = false }) {
  // Static props: drop source animations, and re-compress with meshopt instead of Draco.
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }
  const steps = [dedup(), prune()];
  if (merge) steps.push(flatten(), join({ keepNamed: false }));
  steps.push(weld());
  if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
  steps.push(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize] }),
    dedup(), prune(),
    reorder({ encoder: MeshoptEncoder }),
    quantize(),
  );
  await doc.transform(...steps);
  doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

async function emit(doc, file) {
  const path = joinPath(OUT, file);
  await io.write(path, doc);
  const { size } = await stat(path);
  console.log(`  ${file.padEnd(18)} ${String(triangles(doc)).padStart(7)} tris  ${(size / 1024).toFixed(0).padStart(5)} KB`);
  return size;
}

await mkdir(OUT, { recursive: true });
let total = 0;

console.log('Apollo Lunar Module (split into stages)');
const lmPath = await download('lm');
for (const [file, ascent] of [['lm-descent.glb', false], ['lm-ascent.glb', true]]) {
  const doc = await io.read(lmPath);
  const { kept, dropped } = keepNodes(doc, (node) => isAscent(node) === ascent);
  console.log(`  ${ascent ? 'ascent' : 'descent'}: ${kept} mesh nodes kept, ${dropped} dropped`);
  await optimise(doc, { textureSize: 1024 });
  total += await emit(doc, file);
}

const perseverancePath = await download('perseverance');
console.log('Mars 2020 Perseverance Rover');
{
  const doc = await io.read(perseverancePath);
  console.log(`  source: ${triangles(doc)} tris`);
  await optimise(doc, { textureSize: 512, ratio: 0.2, error: 0.01, merge: true });
  total += await emit(doc, 'perseverance.glb');
}

// Parts lifted out of other NASA models for props NASA has no model of.
console.log('Solar array (from InSight: one deployed UltraFlex wing)');
{
  const doc = await io.read(await download('insight'));
  keepSubtree(doc, 'panel_l_root');
  await optimise(doc, { textureSize: 1024 });
  total += await emit(doc, 'solar-array.glb');
}

console.log('Power unit (from Perseverance: its MMRTG)');
{
  const doc = await io.read(perseverancePath);
  keepSubtree(doc, 'rtg');
  await optimise(doc, { textureSize: 512 });
  total += await emit(doc, 'rtg.glb');
}

console.log('Habitat Demonstration Unit');
{
  const doc = await io.read(await download('hdu'));
  await optimise(doc, { textureSize: 1024 });
  total += await emit(doc, 'hdu.glb');
}

// Stand-ins for the ice plant, which NASA has no model of: the HDU's second
// unit (a finned module on a deck with ramps) processes the ice, and the
// Space Shuttle External Tank, which really held liquid oxygen and hydrogen,
// stores the products.
console.log('Processor (Habitat Demonstration Unit part 2)');
{
  const doc = await io.read(await download('hdu2'));
  console.log(`  source: ${triangles(doc)} tris`);
  await optimise(doc, { textureSize: 1024 });
  total += await emit(doc, 'hdu-processor.glb');
}

console.log('Fuel tank (Space Shuttle External Tank)');
{
  const doc = await io.read(await download('tank'));
  console.log(`  source: ${triangles(doc)} tris`);
  await optimise(doc, { textureSize: 1024 });
  total += await emit(doc, 'fuel-tank.glb');
}

console.log(`Total ${(total / 1024 / 1024).toFixed(2)} MB`);
