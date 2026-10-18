# Titanium oak leaf

The homepage art was created for BLVCK OAK with Thrixel on 18 October 2026.

- Project: `042aef72-850c-4e49-a865-85718a4ca573` (BLVCK OAK — Future Studio).
- Sculpt submission: `2a7b47ed-d6c6-4387-b945-5de4f45ff3ed`.
- Geometry: one mesh, 9,124 triangles, 5,961 vertices. The leaf lies in the XZ plane in a Y-up glTF coordinate system.
- Original: [Thrixel GLB with WebP textures](https://api.thrixel.com/api/v1/2a7b47ed-d6c6-4387-b945-5de4f45ff3ed/download?format=glb&textures=webp&draco=false).
- Web asset: `titanium-oak-leaf.glb`, 199,028 bytes. Face positions, normals and topology are preserved; embedded texture maps and unused UV data are omitted, and indices fit into unsigned 16-bit integers.

`future-scene.js` supplies a titanium physical material and local studio reflections. This produces highlights that move with the actual scene and avoids external texture or decoder requests. No Draco decoder or inline import map is needed.

To reproduce the web asset from the original download:

```sh
node scripts/prepare-oak-model.mjs source.glb assets/models/titanium-oak-leaf.glb
```

The CSS oak-leaf silhouette remains visible while the model loads and when JavaScript or WebGL is unavailable. Scene motion follows the shared pause control, reduced-motion preference, page visibility and viewport visibility.
