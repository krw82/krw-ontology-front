import "./index.css";
import { Composition } from "remotion";
import {
  KrwOntologyAd,
  VIDEO_DURATION_IN_FRAMES,
  type KrwOntologyAdProps,
} from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KrwOntologyAdWide"
        component={KrwOntologyAd}
        durationInFrames={VIDEO_DURATION_IN_FRAMES}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          {
            format: "wide",
          } satisfies KrwOntologyAdProps
        }
      />
      <Composition
        id="KrwOntologyAdVertical"
        component={KrwOntologyAd}
        durationInFrames={VIDEO_DURATION_IN_FRAMES}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={
          {
            format: "vertical",
          } satisfies KrwOntologyAdProps
        }
      />
    </>
  );
};
