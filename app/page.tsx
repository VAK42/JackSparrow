'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import Stats from 'stats.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const keyState: { [key: string]: boolean } = {};
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
}
`;
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
}
`;
export default function OceanPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const boatRef = useRef<THREE.Group | null>(null);
  const boatSpeedRef = useRef(0);
  const boatRotationSpeedRef = useRef(0);
  const waterRef = useRef<Water | null>(null);
  const waterParamsRef = useRef({
    distortionScale: 8,
    size: 1.0,
    wireframe: false
  });
  useEffect(() => {
    if (!containerRef.current) return;
    const onKeyDown = (event: KeyboardEvent) => { keyState[event.code] = true; };
    const onKeyUp = (event: KeyboardEvent) => { keyState[event.code] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    let container = containerRef.current;
    let stats: Stats;
    let camera: THREE.PerspectiveCamera;
    let scene: THREE.Scene;
    let renderer: THREE.WebGLRenderer;
    let sun: THREE.Vector3;
    let clock: THREE.Clock;
    let delta: number;
    let gui: any;
    const waterGeometry = new THREE.PlaneGeometry(1048576, 1048576, 512, 512);
    const waves = {
      A: { direction: 0, steepness: 0.4, wavelength: 60 },
      B: { direction: 30, steepness: 0.4, wavelength: 30 },
      C: { direction: 60, steepness: 0.4, wavelength: 15 },
    };
    function init() {
      renderer = new THREE.WebGLRenderer();
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      container.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      clock = new THREE.Clock();
      camera = new THREE.PerspectiveCamera(
        55,
        window.innerWidth / window.innerHeight,
        1,
        20000
      );
      camera.position.set(30, 30, 100);
      sun = new THREE.Vector3();
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
      const sky = new Sky();
      sky.scale.setScalar(10000);
      scene.add(sky);
      const skyUniforms = sky.material.uniforms;
      skyUniforms['turbidity'].value = 10;
      skyUniforms['rayleigh'].value = 2;
      skyUniforms['mieCoefficient'].value = 0.005;
      skyUniforms['mieDirectionalG'].value = 0.8;
      const parameters = {
        elevation: 2,
        azimuth: 180,
      };
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const water = new Water(waterGeometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load(
          'https://threejs.org/examples/textures/waternormals.jpg',
          function (texture) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          }
        ),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x001e0f,
        distortionScale: waterParamsRef.current.distortionScale,
        fog: scene.fog !== undefined,
      });
      water.rotation.x = -Math.PI / 2;
      scene.add(water);
      waterRef.current = water;
      water.material.uniforms.waveA = { value: [0, 0, 0, 0] };
      water.material.uniforms.waveB = { value: [0, 0, 0, 0] };
      water.material.uniforms.waveC = { value: [0, 0, 0, 0] };
      water.material.uniforms.waveA.value = [
        Math.sin((waves.A.direction * Math.PI) / 180),
        Math.cos((waves.A.direction * Math.PI) / 180),
        waves.A.steepness,
        waves.A.wavelength,
      ];
      water.material.uniforms.waveB.value = [
        Math.sin((waves.B.direction * Math.PI) / 180),
        Math.cos((waves.B.direction * Math.PI) / 180),
        waves.B.steepness,
        waves.B.wavelength,
      ];
      water.material.uniforms.waveC.value = [
        Math.sin((waves.C.direction * Math.PI) / 180),
        Math.cos((waves.C.direction * Math.PI) / 180),
        waves.C.steepness,
        waves.C.wavelength,
      ];
      water.material.onBeforeCompile = function (shader) {
        shader.uniforms.waveA = water.material.uniforms.waveA;
        shader.uniforms.waveB = water.material.uniforms.waveB;
        shader.uniforms.waveC = water.material.uniforms.waveC;
        shader.vertexShader = vertexShader;
        shader.fragmentShader = fragmentShader;
      };
      function updateSun() {
        const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
        const theta = THREE.MathUtils.degToRad(parameters.azimuth);
        sun.setFromSphericalCoords(1, phi, theta);
        sky.material.uniforms['sunPosition'].value.copy(sun);
        if (waterRef.current) {
          waterRef.current.material.uniforms['sunDirection'].value.copy(sun).normalize();
        }
        scene.environment = pmremGenerator.fromScene(sky as any).texture;
      }
      updateSun();
      stats = new Stats();
      container.appendChild(stats.dom);
      gui = new GUI();
      const folderSky = gui.addFolder('Sky');
      folderSky.add(parameters, 'elevation', 0, 90, 0.1).name('Elevation').onChange(updateSun);
      folderSky.add(parameters, 'azimuth', -180, 180, 0.1).name('Azimuth').onChange(updateSun);
      folderSky.open();
      const folderWater = gui.addFolder('Water');
      folderWater
        .add(waterParamsRef.current, 'distortionScale', 0, 8, 0.1).name('Distortion Scale')
        .onChange((v: number) => {
          waterParamsRef.current.distortionScale = v;
          if (waterRef.current) {
            waterRef.current.material.uniforms.distortionScale.value = v;
          }
        });
      folderWater
        .add(waterParamsRef.current, 'size', 0.1, 10, 0.1).name('Size')
        .onChange((v: number) => {
          waterParamsRef.current.size = v;
          if (waterRef.current) {
            waterRef.current.material.uniforms.size.value = v;
          }
        });
      folderWater
        .add(waterParamsRef.current, 'wireframe').name('Wireframe')
        .onChange((v: boolean) => {
          waterParamsRef.current.wireframe = v;
          if (waterRef.current) {
            waterRef.current.material.wireframe = v;
          }
        });
      folderWater.open();
      const waveAFolder = gui.addFolder('Wave A');
      waveAFolder.add(waves.A, 'direction', 0, 359).name('Direction').onChange((v: number) => {
        waves.A.direction = v;
        const x = (v * Math.PI) / 180;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveA.value[0] = Math.sin(x);
          waterRef.current.material.uniforms.waveA.value[1] = Math.cos(x);
        }
      });
      waveAFolder.add(waves.A, 'steepness', 0, 1, 0.1).name('Steepness').onChange((v: number) => {
        waves.A.steepness = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveA.value[2] = v;
        }
      });
      waveAFolder.add(waves.A, 'wavelength', 1, 100).name('Wavelength').onChange((v: number) => {
        waves.A.wavelength = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveA.value[3] = v;
        }
      });
      waveAFolder.open();
      const waveBFolder = gui.addFolder('Wave B');
      waveBFolder.add(waves.B, 'direction', 0, 359).name('Direction').onChange((v: number) => {
        waves.B.direction = v;
        const x = (v * Math.PI) / 180;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveB.value[0] = Math.sin(x);
          waterRef.current.material.uniforms.waveB.value[1] = Math.cos(x);
        }
      });
      waveBFolder.add(waves.B, 'steepness', 0, 1, 0.1).name('Steepness').onChange((v: number) => {
        waves.B.steepness = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveB.value[2] = v;
        }
      });
      waveBFolder.add(waves.B, 'wavelength', 1, 100).name('Wavelength').onChange((v: number) => {
        waves.B.wavelength = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveB.value[3] = v;
        }
      });
      waveBFolder.open();
      const waveCFolder = gui.addFolder('Wave C');
      waveCFolder.add(waves.C, 'direction', 0, 359).name('Direction').onChange((v: number) => {
        waves.C.direction = v;
        const x = (v * Math.PI) / 180;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveC.value[0] = Math.sin(x);
          waterRef.current.material.uniforms.waveC.value[1] = Math.cos(x);
        }
      });
      waveCFolder.add(waves.C, 'steepness', 0, 1, 0.1).name('Steepness').onChange((v: number) => {
        waves.C.steepness = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveC.value[2] = v;
        }
      });
      waveCFolder.add(waves.C, 'wavelength', 1, 100).name('Wavelength').onChange((v: number) => {
        waves.C.wavelength = v;
        if (waterRef.current) {
          waterRef.current.material.uniforms.waveC.value[3] = v;
        }
      });
      waveCFolder.open();
      window.addEventListener('resize', onWindowResize);
    }
    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    function animate() {
      requestAnimationFrame(animate);
      delta = clock.getDelta();
      const time = clock.getElapsedTime();
      if (waterRef.current) {
        waterRef.current.material.uniforms['time'].value = time;
      }
      if (boatRef.current) {
        const currentBoat = boatRef.current;
        if (keyState['KeyW']) boatSpeedRef.current += 0.02;
        const maxRotationSpeed = 0.005;
        const rotationAcceleration = 0.0005;
        const rotationFriction = 0.95;
        if (keyState['KeyA'] && boatSpeedRef.current > 0.1) {
          boatRotationSpeedRef.current += rotationAcceleration;
        } else if (keyState['KeyD'] && boatSpeedRef.current > 0.1) {
          boatRotationSpeedRef.current -= rotationAcceleration;
        } else {
          boatRotationSpeedRef.current *= rotationFriction;
        }
        boatRotationSpeedRef.current = Math.max(-maxRotationSpeed, Math.min(maxRotationSpeed, boatRotationSpeedRef.current));
        boatSpeedRef.current *= 0.98;
        boatSpeedRef.current = Math.max(0, Math.min(4, boatSpeedRef.current));
        currentBoat.rotation.y += boatRotationSpeedRef.current;
        currentBoat.position.y = 5.0;
        const rockX = Math.cos(time * 1.2) * 0.035 + Math.cos(time * 1.8) * 0.045;
        const rockZ = Math.sin(time * 1.0) * 0.035 + Math.sin(time * 2.2) * 0.045;
        const turnBank = boatRotationSpeedRef.current * 1.5;
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
      render();
      stats.update();
    }
    function render() {
      renderer.render(scene, camera);
    }
    init();
    animate();
    return () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (gui) gui.destroy();
      if (waterRef.current) {
        scene.remove(waterRef.current);
        waterRef.current.material.dispose();
      }
      waterGeometry.dispose();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      waterRef.current = null;
      boatRef.current = null;
    };
  }, []);
  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh' }} />
  );
}