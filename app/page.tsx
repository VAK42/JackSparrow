'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const keyState: { [key: string]: boolean } = {};
export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null);
  const boatRef = useRef<THREE.Group>(null);
  const boatSpeedRef = useRef(0);
  const boatRotationSpeedRef = useRef(0);
  useEffect(() => {
    if (!mountRef.current) return;
    const currentMount = mountRef.current;
    const onKeyDown = (event: KeyboardEvent) => { keyState[event.code] = true; };
    const onKeyUp = (event: KeyboardEvent) => { keyState[event.code] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
    camera.position.set(0, 200, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    currentMount.appendChild(renderer.domElement);
    const sun = new THREE.Vector3();
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(50, 50, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -500;
    directionalLight.shadow.camera.right = 500;
    directionalLight.shadow.camera.top = 500;
    directionalLight.shadow.camera.bottom = -500;
    scene.add(directionalLight);
    const sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = 10;
    skyUniforms['rayleigh'].value = 2;
    skyUniforms['mieCoefficient'].value = 0.005;
    skyUniforms['mieDirectionalG'].value = 0.8;
    const parameters = { elevation: 2, azimuth: 180 };
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    let renderTarget: THREE.WebGLRenderTarget;
    function updateSun() {
      const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
      const theta = THREE.MathUtils.degToRad(parameters.azimuth);
      sun.setFromSphericalCoords(1, phi, theta);
      sky.material.uniforms['sunPosition'].value.copy(sun);
      directionalLight.position.copy(sun).multiplyScalar(50);
      if (renderTarget) renderTarget.dispose();
      renderTarget = pmremGenerator.fromScene(sky as any);
      scene.environment = renderTarget.texture;
      water.material.uniforms['sunDirection'].value.copy(sun).normalize();
    }
    const waterGeometry = new THREE.PlaneGeometry(10000, 10000, 512, 512);
    const waterNormals = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg', function (texture) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; });
    const water = new Water(
      waterGeometry,
      {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: waterNormals,
        sunDirection: new THREE.Vector3(),
        waterColor: 0x001e0f,
        distortionScale: 8.0,
        fog: scene.fog !== undefined,
        alpha: 0.9
      }
    );
    water.rotation.x = -Math.PI / 2;
    water.receiveShadow = true;
    water.material.uniforms['size'].value = 4.0;
    const waves = {
      A: { direction: 10, steepness: 0.2, wavelength: 40 },
      B: { direction: 30, steepness: 0.25, wavelength: 25 },
      C: { direction: 190, steepness: 0.2, wavelength: 20 },
    };
    const vertexShader = `
      uniform mat4 textureMatrix;
      uniform float time;
      varying vec4 mirrorCoord;
      varying vec4 worldPosition;
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      uniform vec4 waveA;
      uniform vec4 waveB;
      uniform vec4 waveC;
      vec3 GerstnerWave (vec4 wave, vec3 p) {
          float steepness = wave.z;
          float wavelength = wave.w;
          float k = 2.0 * PI / wavelength;
          float c = sqrt(9.8 / k);
          vec2 d = normalize(wave.xy);
          float f = k * (dot(d, p.xy) - c * time);
          float a = steepness / k;
          return vec3(
              d.x * (a * cos(f)),
              d.y * (a * cos(f)),
              a * sin(f)
          );
      }
      void main() {
          mirrorCoord = modelMatrix * vec4( position, 1.0 );
          worldPosition = mirrorCoord.xyzw;
          mirrorCoord = textureMatrix * mirrorCoord;
          vec3 p = position.xyz;
          p += GerstnerWave(waveA, position.xyz);
          p += GerstnerWave(waveB, position.xyz);
          p += GerstnerWave(waveC, position.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4( p.x, p.y, p.z, 1.0);
          #include <beginnormal_vertex>
          #include <defaultnormal_vertex>
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
          #include <shadowmap_vertex>
      }`;
    const fragmentShader = `
      uniform sampler2D mirrorSampler;
      uniform float alpha;
      uniform float time;
      uniform float size;
      uniform float distortionScale;
      uniform sampler2D normalSampler;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform vec3 eye;
      uniform vec3 waterColor;
      varying vec4 mirrorCoord;
      varying vec4 worldPosition;
      vec4 getNoise( vec2 uv ) {
          vec2 uv0 = ( uv / 103.0 ) + vec2(time / 17.0, time / 29.0);
          vec2 uv1 = uv / 107.0-vec2( time / -19.0, time / 31.0 );
          vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );
          vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );
          vec4 noise = texture2D( normalSampler, uv0 ) +
              texture2D( normalSampler, uv1 ) +
              texture2D( normalSampler, uv2 ) +
              texture2D( normalSampler, uv3 );
          return noise * 0.5 - 1.0;
      }
      void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
          vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
          float direction = max( 0.0, dot( eyeDirection, reflection ) );
          specularColor += pow( direction, shiny ) * sunColor * spec;
          diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
      }
      #include <common>
      #include <packing>
      #include <bsdfs>
      #include <fog_pars_fragment>
      #include <logdepthbuf_pars_fragment>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      void main() {
          #include <logdepthbuf_fragment>
          vec4 noise = getNoise( worldPosition.xz * size );
          vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );
          vec3 diffuseLight = vec3(0.0);
          vec3 specularLight = vec3(0.0);
          vec3 worldToEye = eye-worldPosition.xyz;
          vec3 eyeDirection = normalize( worldToEye );
          sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5, diffuseLight, specularLight );
          float distance = length(worldToEye);
          vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;
          vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );
          float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );
          float rf0 = 0.3;
          float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 5.0 );
          vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;
          vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(), ( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance);
          vec3 outgoingLight = albedo;
          gl_FragColor = vec4( outgoingLight, alpha );
          #include <tonemapping_fragment>
          #include <fog_fragment>
      }`;
    water.material.onBeforeCompile = function (shader) {
      shader.uniforms.waveA = {
        value: [
          Math.sin((waves.A.direction * Math.PI) / 180),
          Math.cos((waves.A.direction * Math.PI) / 180),
          waves.A.steepness,
          waves.A.wavelength,
        ],
      };
      shader.uniforms.waveB = {
        value: [
          Math.sin((waves.B.direction * Math.PI) / 180),
          Math.cos((waves.B.direction * Math.PI) / 180),
          waves.B.steepness,
          waves.B.wavelength,
        ],
      };
      shader.uniforms.waveC = {
        value: [
          Math.sin((waves.C.direction * Math.PI) / 180),
          Math.cos((waves.C.direction * Math.PI) / 180),
          waves.C.steepness,
          waves.C.wavelength,
        ],
      };
      shader.vertexShader = vertexShader;
      shader.fragmentShader = fragmentShader;
    };
    scene.add(water);
    updateSun();
    const boat = new THREE.Group();
    boatRef.current = boat;
    boat.position.set(0, 0, 0);
    boat.rotation.y = -Math.PI / 2;
    scene.add(boat);
    const loader = new GLTFLoader();
    const boatUrl = '/ship.glb';
    loader.load(
      boatUrl,
      (gltf) => {
        const model = gltf.scene;
        model.scale.set(8, 8, 8);
        model.position.set(0, 0, 0);
        model.rotation.y = 0;
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        boat.add(model);
      },
      undefined,
      (_error) => {
        const fallbackGeometry = new THREE.BoxGeometry(20, 5, 50);
        const fallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
        const fallbackHull = new THREE.Mesh(fallbackGeometry, fallbackMaterial);
        fallbackHull.position.y = 2.5;
        fallbackHull.castShadow = true;
        fallbackHull.receiveShadow = true;
        boat.add(fallbackHull);
      }
    );
    const animate = () => {
      requestAnimationFrame(animate);
      water.material.uniforms['time'].value += 1.0 / 60.0;
      const time = water.material.uniforms['time'].value;
      if (boatRef.current) {
        const currentBoat = boatRef.current;
        if (keyState['KeyW']) {
          boatSpeedRef.current += 0.05;
        } else if (keyState['KeyS']) {
          boatSpeedRef.current -= 0.05;
        }
        const maxRotationSpeed = 0.02;
        const rotationAcceleration = 0.001;
        const rotationFriction = 0.95;
        if (keyState['KeyA']) {
          boatRotationSpeedRef.current += rotationAcceleration;
        } else if (keyState['KeyD']) {
          boatRotationSpeedRef.current -= rotationAcceleration;
        } else {
          boatRotationSpeedRef.current *= rotationFriction;
        }
        boatRotationSpeedRef.current = Math.max(-maxRotationSpeed, Math.min(maxRotationSpeed, boatRotationSpeedRef.current));
        boatSpeedRef.current *= 0.98;
        boatSpeedRef.current = Math.max(-2, Math.min(4, boatSpeedRef.current));
        currentBoat.rotation.y += boatRotationSpeedRef.current;
        const bob = Math.sin(time * 1.2) * 1.8 + Math.sin(time * 2.0) * 1.2;
        const rockX = Math.cos(time * 1.2) * 0.035 + Math.cos(time * 1.8) * 0.045;
        const rockZ = Math.sin(time * 1.0) * 0.035 + Math.sin(time * 2.2) * 0.045;
        const turnBank = boatRotationSpeedRef.current * 2.5;
        currentBoat.position.y = bob;
        currentBoat.rotation.x = rockX;
        currentBoat.rotation.z = rockZ + turnBank;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(currentBoat.quaternion);
        currentBoat.position.add(forward.multiplyScalar(boatSpeedRef.current));
        const relativeCameraOffset = new THREE.Vector3(0, 100, -250);
        const cameraOffset = relativeCameraOffset.applyQuaternion(currentBoat.quaternion);
        const cameraPosition = currentBoat.position.clone().add(cameraOffset);
        camera.position.lerp(cameraPosition, 0.1);
        camera.lookAt(currentBoat.position.clone().add(new THREE.Vector3(0, 30, 0)));
      }
      renderer.render(scene, camera);
    };
    animate();
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      if (renderTarget) renderTarget.dispose();
    };
  }, []);
  return <div
    ref={mountRef}
    style={{ width: '100vw', height: '100vh', cursor: 'none' }}
    aria-label="Jack Sparrow"
  />
}