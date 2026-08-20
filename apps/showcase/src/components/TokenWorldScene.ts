import * as THREE from 'three';

const COUNTRY_POINTS: Record<string, [number, number]> = {
  IN: [79, 22],
  JP: [138, 36],
  US: [-98, 39],
  GB: [-2, 54],
  DE: [10, 51],
  FR: [2, 47],
  BR: [-52, -10],
  AU: [134, -25],
  SG: [104, 1],
  CA: [-107, 56],
};

interface Pulse {
  country: string;
}

interface MeteredNavigator extends Navigator {
  connection?: { saveData?: boolean };
}

export function initTokenWorldScene(section: HTMLElement) {
  if (section.dataset.sceneState === 'ready') return;

  const canvas = section.querySelector('canvas');
  const counter = section.querySelector('[data-token-counter]');
  if (!(canvas instanceof HTMLCanvasElement) || !(counter instanceof HTMLElement)) return;

  const reduced =
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (navigator as MeteredNavigator).connection?.saveData === true;
  const current = Number(section.dataset.current || 0);
  const pulses = JSON.parse(section.dataset.pulses || '[]') as Pulse[];
  const formatter = new Intl.NumberFormat('en-US');
  let active = false;
  let frame = 0;
  let selectedPulse = -1;
  let renderer: ReturnType<typeof createRenderer>;

  try {
    renderer = createRenderer(canvas);
  } catch {
    section.dataset.webgl = 'unavailable';
    return;
  }

  section.dataset.sceneState = 'ready';
  section.dataset.webgl = 'ready';
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 0.05, 5.7);
  const world = new THREE.Group();
  world.rotation.y = -0.45;
  world.rotation.x = -0.08;
  scene.add(world);

  const starPositions = [];
  for (let index = 0; index < 180; index += 1) {
    const angle = index * 2.399963;
    const radius = 2.1 + ((index * 47) % 100) / 36;
    starPositions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * 0.72 + 0.3,
      -1.8 - (index % 7) * 0.08
    );
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0x8ea5d2,
        size: 0.012,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    )
  );

  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1.5, 64, 40),
    new THREE.MeshPhysicalMaterial({
      color: 0x07101d,
      emissive: 0x071938,
      emissiveIntensity: 0.55,
      metalness: 0.12,
      roughness: 0.68,
      transparent: true,
      opacity: 0.96,
    })
  );
  world.add(ocean);

  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(1.508, 32, 18),
    new THREE.MeshBasicMaterial({
      color: 0x90a3c9,
      wireframe: true,
      transparent: true,
      opacity: 0.055,
    })
  );
  world.add(wire);

  const landPositions = [];
  for (let lat = -58; lat <= 76; lat += 2.35) {
    for (let lon = -180; lon < 180; lon += 2.35) {
      if (!isLand(lon, lat)) continue;
      const point = globePoint(lon, lat, 1.525);
      landPositions.push(point.x, point.y, point.z);
    }
  }
  const landGeometry = new THREE.BufferGeometry();
  landGeometry.setAttribute('position', new THREE.Float32BufferAttribute(landPositions, 3));
  world.add(
    new THREE.Points(
      landGeometry,
      new THREE.PointsMaterial({
        color: 0xdde7fb,
        size: 0.022,
        transparent: true,
        opacity: 0.88,
        sizeAttenuation: true,
      })
    )
  );

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.68, 64, 40),
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `varying vec3 vNormal; varying vec3 vView; void main(){ vNormal=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vView=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vNormal; varying vec3 vView; void main(){ float rim=pow(1.0-max(dot(vNormal,vView),0.0),3.2); gl_FragColor=vec4(0.16,0.36,0.86,rim*0.42); }`,
    })
  );
  world.add(atmosphere);

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.68, 1.7, 128),
    new THREE.MeshBasicMaterial({
      color: 0x617fc5,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
    })
  );
  halo.position.z = -0.08;
  scene.add(halo);

  scene.add(new THREE.AmbientLight(0x7897d6, 1.35));
  const key = new THREE.DirectionalLight(0xe8efff, 2.8);
  key.position.set(-3, 3, 5);
  scene.add(key);
  const blueRim = new THREE.PointLight(0x1746a2, 18, 12);
  blueRim.position.set(3, -1, -2);
  scene.add(blueRim);

  const pulseMeshes = pulses.flatMap((pulse, index) => {
    const coordinates = COUNTRY_POINTS[pulse.country];
    if (!coordinates) return [];
    const position = globePoint(coordinates[0], coordinates[1], 1.565);
    const normal = position.clone().normalize();
    const group = new THREE.Group();
    group.position.copy(position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf2b345 })
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.055, 0.073, 36),
      new THREE.MeshBasicMaterial({
        color: 0xf2b345,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    group.add(core, ring);
    group.userData = { index, ring };
    world.add(group);
    return [group];
  });

  const draw = (time: number) => {
    pulseMeshes.forEach((group, index) => {
      const phase = reduced ? 0.5 : (time / 1500 + index * 0.27) % 1;
      const selected = selectedPulse === index;
      const scale = selected ? 2.8 : 1 + phase * 2.2;
      const ring = group.userData.ring;
      ring.scale.setScalar(scale);
      ring.material.opacity = selected ? 1 : 0.82 - phase * 0.66;
    });

    renderer.render(scene, camera);
    if (active && !reduced && !document.hidden) {
      world.rotation.y += 0.00105;
      frame = requestAnimationFrame(draw);
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
    draw(performance.now());
  };

  const observer = new IntersectionObserver(
    ([entry]) => {
      active = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (active) {
        counter.textContent = formatter.format(current);
        draw(performance.now());
      }
    },
    { threshold: 0.15 }
  );

  const visibility = () => {
    cancelAnimationFrame(frame);
    if (active && !document.hidden) draw(performance.now());
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    section.dataset.webgl = 'unavailable';
  };
  const contextRestored = () => {
    section.dataset.webgl = 'ready';
    resize();
  };
  const resizeObserver = new ResizeObserver(resize);
  section.querySelectorAll<HTMLElement>('[data-pulse-country]').forEach((button, index) => {
    button.addEventListener('click', () => {
      selectedPulse = selectedPulse === index ? -1 : index;
      section.querySelectorAll('[data-pulse-country]').forEach((candidate, candidateIndex) => {
        candidate.setAttribute('aria-pressed', String(candidateIndex === selectedPulse));
      });
      draw(performance.now());
    });
  });
  observer.observe(section);
  resizeObserver.observe(canvas);
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  resize();

  document.addEventListener(
    'astro:before-swap',
    () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      scene.traverse(
        (object: {
          geometry?: { dispose: () => void };
          material?: { dispose: () => void } | Array<{ dispose: () => void }>;
        }) => {
          const disposable = object;
          disposable.geometry?.dispose();
          const materials = Array.isArray(disposable.material)
            ? disposable.material
            : [disposable.material];
          materials.filter(Boolean).forEach((material) => material?.dispose());
        }
      );
      renderer.dispose();
      section.dataset.sceneState = 'disposed';
    },
    { once: true }
  );
}

function createRenderer(canvas: HTMLCanvasElement) {
  return new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
}

function globePoint(lon: number, lat: number, radius: number) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  return new THREE.Vector3(
    radius * cosPhi * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * cosPhi * Math.cos(lambda)
  );
}

function isLand(lon: number, lat: number) {
  const ellipses = [
    [-102, 48, 34, 25],
    [-82, 18, 18, 20],
    [-61, -17, 18, 31],
    [18, 7, 22, 33],
    [18, 52, 19, 13],
    [68, 48, 54, 22],
    [105, 15, 32, 18],
    [135, -25, 18, 13],
    [-42, 72, 13, 9],
  ];
  return (
    ellipses.some(([x, y, rx, ry]) => ((lon - x) / rx) ** 2 + ((lat - y) / ry) ** 2 < 1) &&
    !(lon > 8 && lon < 45 && lat > 16 && lat < 31)
  );
}
