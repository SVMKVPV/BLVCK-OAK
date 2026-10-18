// Prepare the Thrixel leaf for a locally lit, texture-free website scene.
// Usage: node scripts/prepare-oak-model.mjs source.glb assets/models/titanium-oak-leaf.glb
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Provide source.glb and output.glb paths.');
const input = await readFile(source);
if (input.readUInt32LE(0) !== 0x46546c67 || input.readUInt32LE(4) !== 2) throw new Error('Expected a glTF 2.0 binary model.');
const jsonLength = input.readUInt32LE(12);
const document = JSON.parse(input.subarray(20, 20 + jsonLength).toString('utf8'));
const binaryStart = 20 + jsonLength + 8;
const binary = input.subarray(binaryStart);
if (document.animations?.length || document.skins?.length || document.buffers.length !== 1 || document.buffers[0].uri) throw new Error('Only the static, self-contained hero model is supported.');

const accessors = [];
const bufferViews = [];
const chunks = [];
let length = 0;
const copied = new Map();
function copyAccessor(index, indices = false) {
  if (copied.has(index)) return copied.get(index);
  const accessor = document.accessors[index];
  const view = document.bufferViews[accessor.bufferView];
  if (view.byteStride || accessor.sparse || view.buffer !== 0) throw new Error('Unexpected interleaved or sparse geometry.');
  const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  if (!componentBytes || !components) throw new Error('Unsupported geometry accessor.');
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  let data = binary.subarray(start, start + componentBytes * components * accessor.count);
  let componentType = accessor.componentType;
  if (indices && componentType === 5125 && accessor.max[0] <= 65535) {
    const compact = Buffer.alloc(accessor.count * 2);
    for (let i = 0; i < accessor.count; i++) compact.writeUInt16LE(data.readUInt32LE(i * 4), i * 2);
    data = compact;
    componentType = 5123;
  }
  const padding = (4 - length % 4) % 4;
  if (padding) { chunks.push(Buffer.alloc(padding)); length += padding; }
  const next = accessors.length;
  bufferViews.push({ buffer: 0, byteOffset: length, byteLength: data.length, target: indices ? 34963 : 34962 });
  accessors.push({ ...accessor, bufferView: bufferViews.length - 1, byteOffset: 0, componentType });
  chunks.push(data);
  length += data.length;
  copied.set(index, next);
  return next;
}

const meshes = document.meshes.map(mesh => ({ name: mesh.name, primitives: mesh.primitives.map(primitive => ({
  attributes: Object.fromEntries(Object.entries(primitive.attributes).filter(([name]) => ['POSITION', 'NORMAL'].includes(name)).map(([name, index]) => [name, copyAccessor(index)])),
  indices: copyAccessor(primitive.indices, true),
  mode: primitive.mode ?? 4,
  material: 0,
})) }));
const data = Buffer.concat(chunks);
const output = {
  asset: { version: '2.0', generator: 'Thrixel / BLVCK OAK geometry preparation' },
  scene: document.scene ?? 0,
  scenes: document.scenes,
  nodes: document.nodes,
  meshes, accessors, bufferViews,
  buffers: [{ byteLength: data.length }],
  materials: [{ name: 'Titanium', pbrMetallicRoughness: { baseColorFactor: [.82, .87, .86, 1], metallicFactor: .97, roughnessFactor: .235 } }],
};
const rawJson = Buffer.from(JSON.stringify(output));
const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
const bin = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + json.length + bin.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, Buffer.concat([header, json, binHeader, bin]));
console.log(`Prepared ${destination}: ${28 + json.length + bin.length} bytes, same triangle geometry; textures replaced by scene lighting.`);
