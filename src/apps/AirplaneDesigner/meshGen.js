import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

    function loft(pathA, pathB, dist, segments = 1, endCaps = true) {
        // assert(pathA.length == pathB.length, "Invalid loft of different length paths.");
        const geometry = new THREE.BufferGeometry();
        // Make vertices by extruding the path.
        let tempVerts = [];
        for (let i = 0; i < pathA.length - 1; i++) {
            for (let j = 0; j < segments; j++) {
                // Interpolate between the 2 paths.
                let pathI0 = pathA[i].clone();
                let pathI0J1 = pathA[i].clone();
                pathI0.lerp(pathB[i], j / segments);
                pathI0J1.lerp(pathB[i], (j + 1) / segments);
                let pathI1 = pathA[i + 1].clone();
                let pathI1J1 = pathA[i + 1].clone();
                pathI1.lerp(pathB[i + 1], j / segments);
                pathI1J1.lerp(pathB[i + 1], (j + 1) / segments);
                // Make 2 triangles for each segment.
                tempVerts.push(pathI0.x, pathI0.y, j);
                tempVerts.push(pathI0J1.x, pathI0J1.y, j + dist);
                tempVerts.push(pathI1J1.x, pathI1J1.y, j + dist);

                tempVerts.push(pathI1J1.x, pathI1J1.y, j + dist);
                tempVerts.push(pathI1.x, pathI1.y, j);
                tempVerts.push(pathI0.x, pathI0.y, j);
            }
        }

        if (endCaps) {
            // Make end caps. **** Must be a convex shape for this to work. ****
            // Might also need an even or odd number of verts. IDK.
            let indexA = pathA.length - 1;
            let indexB = 0;
            for (let i = 0; i < pathA.length / 2; i++) {
                tempVerts.push(pathA[indexA].x, pathA[indexA].y, 0);
                tempVerts.push(pathA[indexB].x, pathA[indexB].y, 0);
                tempVerts.push(pathA[indexA-1].x, pathA[indexA-1].y, 0);

                tempVerts.push(pathA[indexA-1].x, pathA[indexA-1].y, 0);
                tempVerts.push(pathA[indexB].x, pathA[indexB].y, 0);
                tempVerts.push(pathA[indexB+1].x, pathA[indexB+1].y, 0);

                tempVerts.push(pathB[indexA].x, pathB[indexA].y, dist);
                tempVerts.push(pathB[indexA-1].x, pathB[indexA-1].y, dist);
                tempVerts.push(pathB[indexB].x, pathB[indexB].y, dist);

                tempVerts.push(pathB[indexA-1].x, pathB[indexA-1].y, dist);
                tempVerts.push(pathB[indexB+1].x, pathB[indexB+1].y, dist);
                tempVerts.push(pathB[indexB].x, pathB[indexB].y, dist);
                indexA--;
                indexB++;
            }
        }


        // itemSize = 3 because there are 3 values (components) per vertex
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tempVerts), 3));
        geometry.computeVertexNormals();
        // Make wireframe material.
        const material = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, side: THREE.DoubleSide, wireframe: false });
        const mesh = new THREE.Mesh(geometry, material);

        return mesh;
    }

    function makeWingMeshes(
        bigRad = 0.5,
        smallRad = 0.1,
        length = 6.0,
        width = 16.0,
        tipScale = 0.5,
        backwardSweep = 0.0,
        vSweep = 0.0
    ) {
        // Make airfoil geometry extruded in the x direction.
        let path = [];
        path.push(new THREE.Vector2(0, bigRad));
        for (let i = 0; i <= 16; i++) {
            let a = (Math.PI * i) / 16.0;
            path.push(new THREE.Vector2(Math.sin(a) * bigRad, Math.cos(a) * bigRad));
            // console.log( Math.sin(a), Math.cos(a));
        }
        // Funny numbers on the small side to lower poly count and try for convexity.
        for (let i = 1; i <= 3; i++) {
            let a = (Math.PI * i) / 4.0;
            a += Math.PI;
            path.push(new THREE.Vector2(Math.sin(a) * smallRad - length, Math.cos(a) * smallRad));
            // console.log( Math.sin(a), Math.cos(a));
        }
        path.push(new THREE.Vector2(0, bigRad));

        let pathB = JSON.parse(JSON.stringify(path)); // deep copy
        for (let i = 0; i < pathB.length; i++) {
            pathB[i].x = pathB[i].x * tipScale - backwardSweep;
            pathB[i].y = pathB[i].y * tipScale + vSweep;
        }
        let group = new THREE.Group();
        let meshR = loft(path, pathB, width);
        meshR.position.z = 0.01; // Make it not touching
        group.add(meshR);
        let meshL = loft(path, pathB, -width);
        meshL.position.z = -0.01; // Make it not touching
        group.add(meshL);

        return group;
    }

    function makeTailFinMesh(bigRad = 0.5, smallRad = 0.1, length = 6.0, width = 16.0, tipScale = 0.5, backwardSweep = 0.0) {
        // Make airfoil geometry extruded in the x direction.
        let path = [];
        path.push(new THREE.Vector2(0, bigRad));
        for (let i = 0; i <= 16; i++) {
            let a = (Math.PI * i) / 16.0;
            path.push(new THREE.Vector2(Math.sin(a) * bigRad, Math.cos(a) * bigRad));
            // console.log( Math.sin(a), Math.cos(a));
        }
        for (let i = 0; i <= 16; i++) {
            let a = (Math.PI * i) / 16.0;
            a += Math.PI;
            path.push(new THREE.Vector2(Math.sin(a) * smallRad - length, Math.cos(a) * smallRad));
            // console.log( Math.sin(a), Math.cos(a));
        }
        path.push(new THREE.Vector2(0, bigRad));

        let pathB = JSON.parse(JSON.stringify(path)); // deep copy
        for (let i = 0; i < pathB.length; i++) {
            pathB[i].x = pathB[i].x * tipScale - backwardSweep;
            pathB[i].y = pathB[i].y * tipScale;
        }
        let mesh = loft(path, pathB, width);

        return mesh;
    }

    export function regenPlane(planeDef, planeGroup, scene) {
        let old = scene.getObjectByName("planeGroup");
        if (old) scene.remove(old);
        planeGroup = new THREE.Group();
        planeGroup.name = "planeGroup";
        let pivotGroup = new THREE.Group();
        pivotGroup.name = "pivotGroup";
        planeGroup.add(pivotGroup);

        let wingMesh = makeWingMeshes(
            planeDef.mainWingThickness.v,
            0.05,
            planeDef.mainWingMiddleLen.v,
            planeDef.mainWingSpan.v * 0.5,
            planeDef.mainWingTipRatio.v,
            planeDef.mainWingSweep.v,
            planeDef.mainWingVSweep.v
        );
        wingMesh.rotateZ((planeDef.mainWingAngle.v * Math.PI) / 180.0);
        wingMesh.position.set(6 + planeDef.mainWingForward.v, 1 + planeDef.mainWingUp.v * planeDef.fuselageRad.v, 0);
        pivotGroup.add(wingMesh);

        let backWingMesh = makeWingMeshes(
            planeDef.backWingThickness.v,
            0.05,
            planeDef.backWingMiddleLen.v,
            planeDef.backWingSpan.v * 0.5,
            planeDef.backWingTipRatio.v,
            planeDef.backWingSweep.v,
            planeDef.backWingVSweep.v
        );
        backWingMesh.rotateZ((planeDef.backWingAngle.v * Math.PI) / 180.0);
        backWingMesh.position.set(-9 + planeDef.backWingForward.v, 1 + planeDef.backWingUp.v * planeDef.fuselageRad.v, 0);
        pivotGroup.add(backWingMesh);

        let tailFinMesh = makeTailFinMesh(
            planeDef.tailFinThickness.v,
            0.05,
            planeDef.tailFinMiddleLen.v,
            planeDef.tailFinSpan.v * 0.5,
            planeDef.tailFinTipRatio.v,
            planeDef.tailFinSweep.v
        );
        tailFinMesh.geometry.rotateX(-Math.PI / 2);
        tailFinMesh.position.set(-16 + planeDef.tailFinMiddleLen.v + planeDef.tailFinForward.v, 1, 0);
        pivotGroup.add(tailFinMesh);

        const geometry = new THREE.CapsuleGeometry(planeDef.fuselageRad.v, planeDef.fuselageLength.v, 4, 32);
        geometry.rotateZ(Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({ color: 0xa0a0a0, side: THREE.DoubleSide, wireframe: false });
        const capsule = new THREE.Mesh(geometry, material);
        capsule.position.set(planeDef.fuselageLength.v * 0.5 - 15, 1, 0);
        pivotGroup.add(capsule);

        // pivotGroup.position.set(0, 1, 0);

        let com = CalcCOM(planeGroup, scene);
        pivotGroup.position.set(-com.x, -com.y, -com.z);
        // pivotGroup.updateMatrixWorld();
        planeGroup.position.set(com.x, com.y, com.z);

        scene.add(planeGroup);
        return planeGroup;
    }

    function CalcCOM(tempPlaneGroup, scene) {
        let start = Date.now();
        tempPlaneGroup.updateMatrixWorld();
        // Calculate bounding box on tempPlaneGroup
        let bbox = new THREE.Box3().setFromObject(tempPlaneGroup);

        let numSamples = 32;
        let totalX = 0.0;
        let totalY = 0.0;
        let totalZ = 0.0;
        let totalMass = 0.0;
        for (let x2 = 0; x2 <= numSamples; x2++) {
            for (let z2 = 0; z2 <= numSamples; z2++) {
                // let x = THREE.MathUtils.randFloat(bbox.min.x, bbox.max.x);
                // let z = THREE.MathUtils.randFloat(bbox.min.z, bbox.max.z);
                let x = THREE.MathUtils.lerp(bbox.min.x, bbox.max.x, x2 / numSamples);
                let z = THREE.MathUtils.lerp(bbox.min.z, bbox.max.z, z2 / numSamples);
                let pos = new THREE.Vector3(x, bbox.max.y + 1.0, z);
                let dir = new THREE.Vector3(0, -1, 0);
                let raycaster = new THREE.Raycaster(pos, dir, 0, 1000);

                const intersects = raycaster.intersectObject(tempPlaneGroup, true);
                if (intersects.length <= 0) continue;

                // console.log(intersects);
                let firstPos = intersects[0].point;
                let lastPos = intersects[intersects.length - 1].point;
                // calculate distance between first and last
                let dist = firstPos.distanceTo(lastPos);
                // Calculate midpoint between first and last
                let midPos = firstPos.clone().add(lastPos).divideScalar(2);
                // Make a sphere at intersection point
                // const geometry = new THREE.SphereGeometry(0.1, 32, 32);
                // const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                // const sphere = new THREE.Mesh(geometry, material);
                // sphere.position.copy(firstPos);
                // scene.add(sphere);
                // const sphere2 = new THREE.Mesh(geometry, material);
                // sphere2.position.copy(lastPos);
                // scene.add(sphere2);

                totalMass += dist;
                totalX += midPos.x * dist;
                totalY += midPos.y * dist;
                totalZ += midPos.z * dist;
            }
        }
        let avgX = totalX / totalMass;
        let avgY = totalY / totalMass;
        let avgZ = totalZ / totalMass;
        let avgPos = new THREE.Vector3(avgX, avgY, avgZ);
        const geometry = new THREE.CylinderGeometry(0.05, 0.05, 6, 32);
        const material = new THREE.MeshBasicMaterial({ color: 0xe01f80 });
        let old = scene.getObjectByName("COM");
        if (old) scene.remove(old);
        let sphereCOM = new THREE.Mesh(geometry, material);
        sphereCOM.name = "COM";
        sphereCOM.position.copy(avgPos);
        scene.add(sphereCOM);
        // console.log("avgPos", Date.now() - start, avgPos);
        return avgPos;
    }

    export function saveToSTL(planeGroup, planeDef) {
        console.log("saveToSTL", planeDef)
        const link = document.createElement("a");
        link.style.display = "none";
        document.body.appendChild(link);

        const exporter = new STLExporter();
        // Configure export options
        const options = { binary: true };
        // Parse the input and generate the STL encoded output
        const result = exporter.parse(planeGroup, options);
        saveString(result, "box.stl");

        function save(blob, filename) {
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            link.click();
        }

        function saveString(text, filename) {
            save(new Blob([text], { type: "text/plain" }), filename);
        }
    }
