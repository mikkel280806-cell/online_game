import { ShaderChunk } from 'three';

/**
 * GLSL: replace NaN/Infinity with 0 and clamp to a sane HDR range.
 * Uses the float's bits rather than isnan()/x!=x, which fast-math GPU compilers may drop.
 */
export const SANITIZE_GLSL = /* glsl */ `
vec3 hsSanitize(vec3 c) {
  uvec3 bits = floatBitsToUint(c);
  bvec3 bad = equal(bits & uvec3(0x7f800000u), uvec3(0x7f800000u));
  c = mix(c, vec3(0.0), vec3(bad));
  return clamp(c, 0.0, 1024.0);
}
`;

/**
 * Keep every lit material's output finite and in range before it reaches the HDR buffer.
 *
 * Real GPUs return NaN for things like pow() of a tiny negative number, and a mirror-like
 * surface catching the low sun can overflow a 16-bit float to Infinity. One such pixel is
 * enough: the bloom blur smears it across the whole frame and the screen goes black. Software
 * renderers (our cloud screenshots) don't show it, so we guard against it everywhere.
 */
export function installRadianceClamp(): void {
  if (ShaderChunk.opaque_fragment.includes('hsSanitize')) return;
  ShaderChunk.common = `${ShaderChunk.common}\n${SANITIZE_GLSL}`;
  ShaderChunk.opaque_fragment = ShaderChunk.opaque_fragment.replace(
    'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    'gl_FragColor = vec4( hsSanitize( outgoingLight ), clamp( diffuseColor.a, 0.0, 1.0 ) );',
  );
  // Fog is applied after the material's own output: sanitise again at the very end.
  ShaderChunk.fog_fragment = `${ShaderChunk.fog_fragment}\ngl_FragColor.rgb = hsSanitize( gl_FragColor.rgb );`;
}
