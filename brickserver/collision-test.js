/*
  Collision test for two 3001 bricks using three-mesh-bvh.
  Loads geometry from public/apps/bricks/test_3001.gltf via @gltf-transform/core,
  builds BVHs, and checks for intersection when one brick is translated +24 in Y.
*/

const path = require('path');
const { NodeIO, Document } = require('@gltf-transform/core');
const fs = require('fs').promises;
const THREE = require('three');
const {
  MeshBVH,
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} = require('three-mesh-bvh');

// Attach BVH helpers to three prototypes
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

async function loadGeometryFromGLTFNode(gltfPath, targetNodeName = 'partnostuds') {
  const io = new NodeIO();
  const document = await io.read(gltfPath);
  const root = document.getRoot();
  
  // Prefer the mesh attached to a node with the given name
  const nodes = root.listNodes();
  let mesh = null;
  const partNode = nodes.find(n => (n.getName && n.getName() === targetNodeName) && n.getMesh());
  if (partNode) {
    mesh = partNode.getMesh();
  } else {
    // Fallback to the first mesh if named node not found
    const meshes = root.listMeshes();
    if (!meshes || meshes.length === 0) {
      throw new Error('No meshes found in GLTF: ' + gltfPath);
    }
    mesh = meshes[0];
    console.warn(`Node named "${targetNodeName}" not found. Falling back to first mesh.`);
  }

  const primitives = mesh.listPrimitives();
  if (!primitives || primitives.length === 0) {
    throw new Error('No primitives found in first mesh.');
  }

  const prim = primitives[0];
  const posAcc = prim.getAttribute('POSITION');
  if (!posAcc) {
    throw new Error('Primitive has no POSITION attribute.');
  }

  const positionArray = posAcc.getArray(); // Typed array
  const indexAcc = prim.getIndices();
  const indexArray = indexAcc ? indexAcc.getArray() : null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(
    positionArray.buffer ? new Float32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length) : new Float32Array(positionArray),
    3
  ));

  if (indexArray) {
    // Preserve the underlying type (Uint16Array/Uint32Array)
    const TypedIdx = indexArray.constructor;
    geometry.setIndex(new THREE.BufferAttribute(
      indexArray.buffer ? new TypedIdx(indexArray.buffer, indexArray.byteOffset, indexArray.length) : new TypedIdx(indexArray),
      1
    ));
  }

  geometry.computeVertexNormals();
  return geometry;
}

async function main() {
  try {
    const testPath = path.join(__dirname, '..', 'public', 'apps', 'bricks', 'test_3001.gltf');
    const baseGeometry = await loadGeometryFromGLTFNode(testPath, 'partnostuds');

    // Use the raw geometry without any shrink along normals
    const testGeometry = baseGeometry;

    // Build BVH for both instances
    testGeometry.computeBoundsTree();

    // Create two meshes sharing the same geometry (ok for BVH tests)
    const meshA = new THREE.Mesh(testGeometry, new THREE.MeshBasicMaterial());
    const meshB = new THREE.Mesh(testGeometry, new THREE.MeshBasicMaterial());

    // Place A at origin, B at y=24
    meshA.position.set(0, 0, 0);
    meshA.updateMatrixWorld(true);

    meshB.position.set(0, 24, 0);
    meshB.updateMatrixWorld(true);

    // three-mesh-bvh intersection test using the geometry BVH
    // Build an explicit BVH object in case geometry didn't attach one
    const bvhA = testGeometry.boundsTree || new MeshBVH(testGeometry);

    const intersects = bvhA.intersectsGeometry(
      meshB.geometry,
      meshB.matrixWorld,
      meshA.matrixWorld
    );

    console.log('Collision test: 3001 vs 3001 @ Δy=24');
    console.log('Intersects:', intersects);

    // Optional: also test a slightly smaller/larger offset for sanity
    meshB.position.set(0, 24.0, 0); meshB.updateMatrixWorld(true);
    const intersectsClose = bvhA.intersectsGeometry(meshB.geometry, meshB.matrixWorld, meshA.matrixWorld);
    meshB.position.set(0, 24.1, 0); meshB.updateMatrixWorld(true);
    const intersectsFar = bvhA.intersectsGeometry(meshB.geometry, meshB.matrixWorld, meshA.matrixWorld);

    console.log('Intersects at 23.9:', intersectsClose, '| at 24.1:', intersectsFar);

    // Export a GLTF with two instances separated by 24.1 on Y
    await exportSceneGLTF(testGeometry, path.join(__dirname, 'output', 'collision_scene_3001_y24p1.gltf'), 24.1);
    console.log('Wrote GLTF to brickserver/output/collision_scene_3001_y24p1.gltf');
  } catch (err) {
    console.error('Collision test failed:', err);
    process.exitCode = 1;
  }
}

main();


// Build a minimal GLTF document with two instances of the given THREE BufferGeometry
async function exportSceneGLTF(bufferGeometry, outputPath, yOffset) {
  const document = new Document();
  const root = document.getRoot();
  // Create default buffer for binary resources
  document.createBuffer('default');

  // Ensure output dir exists
  const outDir = path.dirname(outputPath);
  await fs.mkdir(outDir, { recursive: true });

  // Create accessors from THREE geometry
  const posAttr = bufferGeometry.getAttribute('position');
  const norAttr = bufferGeometry.getAttribute('normal');
  const idxAttr = bufferGeometry.getIndex();

  const positionAccessor = document.createAccessor('position')
    .setType('VEC3')
    .setArray(new Float32Array(posAttr.array));

  const normalAccessor = document.createAccessor('normal')
    .setType('VEC3')
    .setArray(new Float32Array(norAttr.array));

  const primitive = document.createPrimitive()
    .setAttribute('POSITION', positionAccessor)
    .setAttribute('NORMAL', normalAccessor);

  if (idxAttr) {
    const indexArray = idxAttr.array;
    const indexAccessor = document.createAccessor('indices')
      .setType('SCALAR')
      .setArray(indexArray.constructor === Uint32Array
        ? new Uint32Array(indexArray)
        : new Uint16Array(indexArray));
    primitive.setIndices(indexAccessor);
  }

  const mesh = document.createMesh('brick').addPrimitive(primitive);

  const nodeA = document.createNode('brickA').setMesh(mesh).setTranslation([0, 0, 0]);
  const nodeB = document.createNode('brickB').setMesh(mesh).setTranslation([0, yOffset, 0]);

  const scene = document.createScene('Scene').addChild(nodeA).addChild(nodeB);
  root.setDefaultScene(scene);

  const io = new NodeIO();
  await io.write(outputPath, document);
}


