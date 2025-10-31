import * as THREE from 'three';

/**
 * Creates a new animation clip by "baking" the effects of a collision manager onto it.
 * It samples the animation at a fixed frame rate, applies collision, and records the results.
 * @param {THREE.Object3D} model - The rigged model containing the skeleton.
 * @param {THREE.AnimationClip} sourceClip - The original animation clip to bake.
 * @param {CollisionManager} collisionManager - The collision manager to apply.
 * @returns {Promise<THREE.AnimationClip>} A new AnimationClip with collision avoidance baked in.
 */
export async function bakeAnimationWithCollision(model, sourceClip, collisionManager) {
    const frameRate = 30;
    const deltaTime = 1 / frameRate;
    const totalFrames = Math.ceil(sourceClip.duration * frameRate);

    // Get all bones from the model's skeleton
    const skeleton = model.getObjectByProperty('isSkinnedMesh', true)?.skeleton;
    if (!skeleton) {
        throw new Error("Skeleton not found for baking.");
    }
    const bones = skeleton.bones;

    // Set up a temporary animation mixer
    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(sourceClip);
    action.play();

    // Data structure to hold the baked keyframe data for each bone
    const bakedTracksData = new Map(bones.map(b => [b.name, {
        positions: [],
        quaternions: [],
        times: []
    }]));

    // Reset skeleton to bind pose before starting
    skeleton.pose();
    model.updateMatrixWorld(true);

    // Process each frame
    for (let i = 0; i <= totalFrames; i++) {
        const time = i * deltaTime;
        
        // 1. Reset skeleton and advance animation to the current frame
        skeleton.pose(); // Reset to bind pose before setting time
        mixer.setTime(time);
        model.updateMatrixWorld(true);

        // 2. Apply collision avoidance for this pose
        // Run a few iterations to allow the solver to settle
        for (let j = 0; j < 5; j++) {
            collisionManager.update();
        }

        // 3. Record the final (corrected) local transforms for each bone
        for (const bone of bones) {
            const trackData = bakedTracksData.get(bone.name);
            trackData.times.push(time);
            trackData.positions.push(...bone.position.toArray());
            trackData.quaternions.push(...bone.quaternion.toArray());
        }

        // Yield to the event loop occasionally to prevent browser freezing on long animations
        if (i % frameRate === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // Clean up the mixer
    mixer.stopAllAction();

    // Create new KeyframeTracks from the baked data
    const bakedTracks = [];
    for (const [boneName, trackData] of bakedTracksData.entries()) {
        if (trackData.times.length > 0) {
            bakedTracks.push(new THREE.VectorKeyframeTrack(
                `${boneName}.position`,
                trackData.times,
                trackData.positions
            ));
            bakedTracks.push(new THREE.QuaternionKeyframeTrack(
                `${boneName}.quaternion`,
                trackData.times,
                trackData.quaternions
            ));
        }
    }
    
    // Create and return the new AnimationClip
    const bakedClip = new THREE.AnimationClip(
        `${sourceClip.name}_baked`,
        sourceClip.duration,
        bakedTracks
    );

    // Reset skeleton back to bind pose
    skeleton.pose();
    model.updateMatrixWorld(true);

    return bakedClip;
}