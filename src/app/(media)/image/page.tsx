import type { Metadata } from "next";
import ImageStudio from "./ImageStudio";

export const metadata: Metadata = { title: "UZ 이미지" };

export default function ImagePage() {
  return <ImageStudio />;
}
