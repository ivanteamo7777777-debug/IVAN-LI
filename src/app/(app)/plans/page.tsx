import type { Metadata } from "next";
import { PlansView } from "@/components/plans-view";

export const metadata: Metadata = { title: "计划库" };

export default function PlansPage() {
  return <PlansView />;
}
