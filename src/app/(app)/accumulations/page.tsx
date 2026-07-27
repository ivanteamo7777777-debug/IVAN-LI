import type { Metadata } from "next";
import { AccumulationsView } from "@/components/accumulations-view";

export const metadata: Metadata = { title: "长期积累库" };

export default function AccumulationsPage() {
  return <AccumulationsView />;
}
