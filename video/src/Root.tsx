import { Composition } from "remotion";
import { Analog, FPS, TOTAL } from "./Analog";

export const Root = () => (
  <Composition id="Analog" component={Analog} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
);
