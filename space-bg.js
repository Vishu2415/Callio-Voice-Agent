document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("three-space-bg");
  if (!canvas) return;

  // Basic Three.js Setup
  const scene = new THREE.Scene();
  
  // Fog for depth effect
  scene.fog = new THREE.FogExp2(0x0a0e19, 0.001);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    1,
    2000
  );
  camera.position.z = 1000;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio to 2 for performance

  // Particles (Stars)
  const starGeo = new THREE.BufferGeometry();
  const starCount = 400; // Optimized: Reduced from 4000 to 400 for low CPU usage
  const positions = new Float32Array(starCount * 3);
  const velocities = [];

  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = Math.random() * 2000 - 1000;
    positions[i * 3 + 1] = Math.random() * 2000 - 1000;
    positions[i * 3 + 2] = Math.random() * 2000 - 1000;
    
    // Slight random velocity for each star
    velocities.push({
      x: (Math.random() - 0.5) * 0.1,
      y: (Math.random() - 0.5) * 0.1,
      z: (Math.random() - 0.5) * 0.1 + 0.5 // base forward movement
    });
  }

  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  // Circular Star Texture (Optional, but looks better)
  let sprite = new THREE.TextureLoader().load( 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/sprites/circle.png' );
  
  const starMat = new THREE.PointsMaterial({
    color: 0x8b5cf6, // Violet tint to match theme
    size: 3.5,
    map: sprite,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Animation Loop
  let animationId = null;
  let isRunning = true;

  function animate() {
    if (!isRunning) return;
    animationId = requestAnimationFrame(animate);

    const positions = starGeo.attributes.position.array;
    for (let i = 0; i < starCount; i++) {
      let x = positions[i * 3];
      let y = positions[i * 3 + 1];
      let z = positions[i * 3 + 2];

      const vel = velocities[i];
      
      // Move star
      x += vel.x;
      y += vel.y;
      z += vel.z;

      // Reset star if it goes past camera or bounds
      if (z > 1000) {
        z -= 2000;
        x = Math.random() * 2000 - 1000;
        y = Math.random() * 2000 - 1000;
      }
      if (y < -1000) y += 2000;
      if (y > 1000) y -= 2000;
      if (x < -1000) x += 2000;
      if (x > 1000) x -= 2000;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    starGeo.attributes.position.needsUpdate = true;

    // Slow subtle rotation for the whole system
    stars.rotation.y += 0.0005;
    stars.rotation.x -= 0.0002;

    renderer.render(scene, camera);
  }

  // Handle visibility changes to pause animation in background tabs
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      isRunning = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    } else {
      if (!isRunning) {
        isRunning = true;
        animate();
      }
    }
  });

  animate();

  // Handle Resize
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
});
