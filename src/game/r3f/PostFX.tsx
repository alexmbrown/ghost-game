import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing';

import { HeightFog, type HeightFogSettings } from './fx/HeightFog';

/**
 * Screen-space effects. Bloom is what makes emissive flames, eyes and portals
 * read as "glowing" — the single biggest jump in game feel. Ground fog comes
 * first so bloom and vignette work on the fogged image.
 */
export function PostFX({ fog }: { fog?: HeightFogSettings }) {
  return (
    <EffectComposer multisampling={0}>
      {fog ? <HeightFog settings={fog} /> : <></>}
      <Bloom
        intensity={1.15}
        luminanceThreshold={0.22}
        luminanceSmoothing={0.85}
        mipmapBlur
        radius={0.72}
      />
      <Vignette offset={0.28} darkness={0.72} eskil={false} />
      <SMAA />
    </EffectComposer>
  );
}
