import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface HeroQuantCanvasProps {
  theme: 'dark' | 'light';
  pointerRef: React.MutableRefObject<{ x: number; y: number; active: boolean }>;
}

// Pre-allocated math helpers at module scope (zero GC allocations inside render loop)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 2.15);
const _hoverTarget = new THREE.Vector3(0, -2.15, 0);
const _dummy = new THREE.Object3D();
const _darkBase = new THREE.Color(0x0d0f14);
const _darkCrest = new THREE.Color(0xb46910);
const _lightBase = new THREE.Color(0xdbe1ea);
const _lightCrest = new THREE.Color(0xd97706);
const _workColor = new THREE.Color();

function createSoftGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 198, 92, 1)');
    grad.addColorStop(0.32, 'rgba(255, 176, 32, 0.45)');
    grad.addColorStop(1, 'rgba(255, 176, 32, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const HeroQuantCanvas: React.FC<HeroQuantCanvasProps> = ({ theme, pointerRef }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(theme);
  const [webglReady, setWebglReady] = useState(false);

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Detect software WebGL cleanly without polluting the active context
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));

    const rect = container.getBoundingClientRect();
    const initW = Math.max(rect.width, 320);
    const initH = Math.max(rect.height, 320);
    renderer.setSize(initW, initH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const initialBg = themeRef.current === 'dark' ? 0x000000 : 0xf8fafc;
    scene.background = new THREE.Color(initialBg);
    const fog = new THREE.FogExp2(initialBg, 0.052);
    scene.fog = fog;

    // Studio environment reflection so brushed titanium & amber metallic highlights read richly
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, initW / initH, 0.1, 80);
    camera.position.set(0, 1.35, 11.8);
    camera.lookAt(0, -0.55, 0);

    // Three-point architectural lighting rig
    const hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x050507, 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffcf78, 1.45);
    keyLight.position.set(6, 9, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xf59e0b, 0.85);
    rimLight.position.set(-7, 4, -8);
    scene.add(rimLight);

    // Interactive warm amber cursor light hovering just above the obsidian column grid
    const cursorLight = new THREE.PointLight(0xffb020, 0, 11, 1.6);
    cursorLight.position.set(0, -0.8, 0);
    scene.add(cursorLight);

    // 1. Instanced Hexagonal Obsidian Pillars Field (27 x 27 grid, clipped to circular disk)
    const gridSide = 27;
    const spacing = 0.74;
    const pillarCoords: Array<{ x: number; z: number; phase: number }> = [];
    for (let ix = 0; ix < gridSide; ix++) {
      for (let iz = 0; iz < gridSide; iz++) {
        const x = (ix - (gridSide - 1) / 2) * spacing;
        const z = (iz - (gridSide - 1) / 2) * spacing - 1.5;
        const radial = Math.hypot(x, z + 1.5);
        if (radial <= 10.6) {
          pillarCoords.push({ x, z, phase: ix * 0.27 + iz * 0.31 });
        }
      }
    }

    const pillarCount = pillarCoords.length;
    const pillarGeo = new THREE.CylinderGeometry(0.24, 0.27, 1.8, 6);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.82,
      roughness: 0.28,
    });
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarCount);
    pillars.frustumCulled = false;

    const pillarHeights = new Float32Array(pillarCount);
    for (let i = 0; i < pillarCount; i++) {
      pillarHeights[i] = 0.35;
      _dummy.position.set(pillarCoords[i].x, -2.55, pillarCoords[i].z);
      _dummy.scale.set(1, 0.35, 1);
      _dummy.updateMatrix();
      pillars.setMatrixAt(i, _dummy.matrix);
      pillars.setColorAt(i, themeRef.current === 'dark' ? _darkBase : _lightBase);
    }
    pillars.instanceMatrix.needsUpdate = true;
    if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
    pillars.computeBoundingSphere();
    scene.add(pillars);

    // 2. Architectural Concentric Horizon Rings (Composite 3-part Group)
    const ringGroup = new THREE.Group();
    ringGroup.position.set(0, -0.35, -3.4);

    const outerRingGeo = new THREE.TorusGeometry(6.1, 0.015, 12, 140);
    const outerRingMat = new THREE.MeshStandardMaterial({
      color: 0xffb020,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x5c3400,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.32,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = Math.PI * 0.39;

    const innerRingGeo = new THREE.TorusGeometry(4.35, 0.011, 12, 120);
    const innerRingMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.85,
      roughness: 0.25,
      transparent: true,
      opacity: 0.2,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = Math.PI * 0.43;
    innerRing.rotation.y = 0.22;

    const horizonRimGeo = new THREE.TorusGeometry(8.2, 0.01, 10, 140);
    const horizonRimMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.35,
      transparent: true,
      opacity: 0.14,
    });
    const horizonRim = new THREE.Mesh(horizonRimGeo, horizonRimMat);
    horizonRim.rotation.x = Math.PI * 0.47;

    ringGroup.add(outerRing, innerRing, horizonRim);
    scene.add(ringGroup);

    // 3. Soft Drifting Amber Micro-Particles (depth accents outside the center focal band)
    const particleCount = 130;
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSeeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.2 + Math.random() * 8.5;
      particlePositions[i * 3] = Math.cos(angle) * radius;
      particlePositions[i * 3 + 1] = -1.6 + Math.random() * 4.8;
      particlePositions[i * 3 + 2] = -6.5 + Math.random() * 7.5;
      particleSeeds[i] = Math.random() * Math.PI * 2;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const glowTex = createSoftGlowTexture();
    const particleMat = new THREE.PointsMaterial({
      size: 0.14,
      map: glowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Damped hover & camera tracking state
    const smoothHover = new THREE.Vector3(0, -2.15, -1.5);
    let smoothHoverStrength = 0;
    let camX = 0;
    let camY = 1.35;

    let frameId = 0;
    let disposed = false;
    let isVisible = true;
    let contextLost = false;
    const clock = new THREE.Clock();

    function applyTheme(dark: boolean) {
      const targetBg = dark ? 0x000000 : 0xf8fafc;
      if (scene.background instanceof THREE.Color) {
        scene.background.setHex(targetBg);
      }
      fog.color.setHex(targetBg);
      fog.density = dark ? 0.052 : 0.04;
      hemiLight.intensity = dark ? 0.55 : 0.85;
      outerRingMat.opacity = dark ? 0.3 : 0.22;
      innerRingMat.opacity = dark ? 0.18 : 0.14;
      particleMat.opacity = dark ? 0.45 : 0.25;
    }

    function updateScene(elapsed: number, delta: number) {
      const dark = themeRef.current === 'dark';
      applyTheme(dark);

      const { x: px, y: py, active } = pointerRef.current;

      // Cast pointer ray against horizon plane
      if (active) {
        _ndc.set(px, py);
        _raycaster.setFromCamera(_ndc, camera);
        _raycaster.ray.intersectPlane(_groundPlane, _hoverTarget);
        _hoverTarget.x = THREE.MathUtils.clamp(_hoverTarget.x, -10, 10);
        _hoverTarget.z = THREE.MathUtils.clamp(_hoverTarget.z, -11, 7);
      }

      smoothHover.x = THREE.MathUtils.damp(smoothHover.x, _hoverTarget.x, 7, delta);
      smoothHover.z = THREE.MathUtils.damp(smoothHover.z, _hoverTarget.z, 7, delta);
      smoothHoverStrength = THREE.MathUtils.damp(smoothHoverStrength, active ? 1 : 0, 5.5, delta);

      // Gentle cursor point light gliding smoothly over the metallic surface
      cursorLight.position.set(smoothHover.x, -0.5, smoothHover.z);
      cursorLight.intensity = (dark ? 7.5 : 3.5) * smoothHoverStrength;

      // Subtle camera parallax (restrained so overlaid DOM headline feels rock-steady)
      const targetCamX = active ? px * 0.42 : Math.sin(elapsed * 0.16) * 0.18;
      const targetCamY = active ? 1.35 + py * 0.22 : 1.35 + Math.cos(elapsed * 0.14) * 0.08;
      camX = THREE.MathUtils.damp(camX, targetCamX, 3.8, delta);
      camY = THREE.MathUtils.damp(camY, targetCamY, 3.8, delta);
      camera.position.set(camX, camY, 11.8);
      camera.lookAt(0, -0.55, 0);

      // Architectural horizon rings respond gently to pointer & subtle ambient rotation
      ringGroup.rotation.y = THREE.MathUtils.damp(
        ringGroup.rotation.y,
        (active ? px * 0.16 : 0) + elapsed * 0.035,
        3.5,
        delta,
      );
      ringGroup.rotation.x = THREE.MathUtils.damp(
        ringGroup.rotation.x,
        active ? -py * 0.07 : 0,
        3.5,
        delta,
      );
      outerRing.rotation.z = elapsed * 0.03;
      innerRing.rotation.z = -elapsed * 0.045;

      // Update hexagonal obsidian field instances
      const baseColor = dark ? _darkBase : _lightBase;
      const crestColor = dark ? _darkCrest : _lightCrest;

      for (let i = 0; i < pillarCount; i++) {
        const { x, z, phase } = pillarCoords[i];
        const ambientWave =
          0.34 +
          0.18 * Math.sin(x * 0.42 + elapsed * 0.72) * Math.cos(z * 0.38 - elapsed * 0.55) +
          0.08 * Math.sin(phase + elapsed * 0.9);

        const dx = x - smoothHover.x;
        const dz = z - smoothHover.z;
        const distSq = dx * dx + dz * dz;
        const hoverInfluence =
          smoothHoverStrength * Math.exp(-distSq / 9.5) * (0.72 + 0.14 * Math.sin(distSq * 1.1 - elapsed * 4.5));

        const targetScaleY = Math.max(0.18, ambientWave + hoverInfluence * 0.95);
        const curScaleY = THREE.MathUtils.damp(pillarHeights[i], targetScaleY, 8, delta);
        pillarHeights[i] = curScaleY;

        const baseOffsetY = -2.75 + curScaleY * 0.9;
        _dummy.position.set(x, baseOffsetY, z);
        _dummy.scale.set(1, curScaleY, 1);
        _dummy.updateMatrix();
        pillars.setMatrixAt(i, _dummy.matrix);

        const glowMix = THREE.MathUtils.clamp(hoverInfluence * 1.15 + Math.max(0, ambientWave - 0.45) * 0.35, 0, 1);
        _workColor.copy(baseColor).lerp(crestColor, glowMix);
        pillars.setColorAt(i, _workColor);
      }
      pillars.instanceMatrix.needsUpdate = true;
      if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;

      // Drift ambient particles upward very gently
      const posAttr = particleGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < particleCount; i++) {
        const seed = particleSeeds[i];
        let y = posAttr.getY(i) + delta * 0.11;
        if (y > 3.2) y = -1.6;
        posAttr.setY(i, y);
        posAttr.setX(i, posAttr.getX(i) + Math.sin(elapsed * 0.4 + seed) * delta * 0.04);
      }
      posAttr.needsUpdate = true;
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed || !isVisible || contextLost) return;
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed || !isVisible || contextLost) return;
      const delta = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();
      updateScene(elapsed, delta);
      renderer.render(scene, camera);

      if (prefersReducedMotion) return;
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Initial render
    updateScene(0, 0.016);
    renderer.render(scene, camera);
    setWebglReady(true);

    if (!prefersReducedMotion) {
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Pause animation loop completely whenever Hero scrolls offscreen
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const nextVisible = Boolean(entry?.isIntersecting);
        if (nextVisible === isVisible) return;
        isVisible = nextVisible;
        if (isVisible && !prefersReducedMotion && !contextLost && !disposed) {
          clock.getDelta();
          if (isSoftwareGl) afterDraw(tick);
          else frameId = requestAnimationFrame(tick);
        } else {
          cancelAnimationFrame(frameId);
          clearTimeout(frameId);
        }
      },
      { threshold: 0.05 },
    );
    io.observe(container);

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      const nextRect = container.getBoundingClientRect();
      const w = Math.max(nextRect.width, 320);
      const h = Math.max(nextRect.height, 320);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
      if (prefersReducedMotion) {
        renderer.render(scene, camera);
      }
    });
    ro.observe(container);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      setWebglReady(false);
    };
    const handleContextRestored = () => {
      contextLost = false;
      setWebglReady(true);
      if (!prefersReducedMotion && isVisible && !disposed) {
        clock.getDelta();
        frameId = requestAnimationFrame(tick);
      }
    };

    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      io.disconnect();
      ro.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      pillarGeo.dispose();
      pillarMat.dispose();
      outerRingGeo.dispose();
      outerRingMat.dispose();
      innerRingGeo.dispose();
      innerRingMat.dispose();
      horizonRimGeo.dispose();
      horizonRimMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      glowTex.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [pointerRef]);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${
        webglReady ? 'opacity-100' : 'opacity-0'
      }`}
    />
  );
};
