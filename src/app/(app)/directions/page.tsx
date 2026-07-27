import type { Metadata } from "next";
import { DirectionsView } from "@/components/directions-view";

export const metadata: Metadata = { title: "方向库" };

export default function DirectionsPage() {
  return <DirectionsView />;
}
