import type { Metadata } from "next";
import VideoStudio from "./VideoStudio";

export const metadata: Metadata = { title: "UZ 영상" };

export default function VideoPage() {
  return <VideoStudio />;
}
